import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: 6 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (error) {
    const message = String(error?.stderr || error?.message || "Git operation failed").trim();
    throw new Error(message);
  }
}

async function repoRoot(cwd) {
  const { stdout } = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

function validatePath(root, filePath) {
  const absolute = path.resolve(root, filePath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("文件不在当前 Git 项目内");
  return relative.replace(/\\/g, "/");
}

export async function getChangeReview(cwd) {
  let root;
  try {
    root = await repoRoot(cwd);
  } catch {
    return {
      isGitRepository: false,
      root: path.resolve(cwd),
      files: [],
    };
  }
  const { stdout } = await git(root, ["status", "--short"]);
  const files = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const status = line.slice(0, 2);
    const rawPath = line.slice(3).split(" -> ").at(-1).trim();
    const filePath = validatePath(root, rawPath);
    let diff = "";
    if (!status.includes("?") && !status.includes("A")) {
      const result = await git(root, ["diff", "--no-ext-diff", "--", filePath]);
      diff = result.stdout;
      if (!diff && status[0] !== " ") diff = (await git(root, ["diff", "--cached", "--no-ext-diff", "--", filePath])).stdout;
    }
    files.push({ path: filePath, status, diff, isUntracked: status.includes("?") });
  }
  return { isGitRepository: true, root, files };
}

export async function acceptChangeFile(cwd, filePath) {
  const root = await repoRoot(cwd);
  const safePath = validatePath(root, filePath);
  await git(root, ["add", "--", safePath]);
  return getChangeReview(root);
}

export async function revertChangeFile(cwd, filePath) {
  const root = await repoRoot(cwd);
  const safePath = validatePath(root, filePath);
  const { stdout } = await git(root, ["status", "--short", "--", safePath]);
  if (stdout.includes("??")) {
    throw new Error("未跟踪文件不会被自动删除，请手动处理此文件");
  }
  await git(root, ["restore", "--staged", "--worktree", "--source=HEAD", "--", safePath]);
  return getChangeReview(root);
}
