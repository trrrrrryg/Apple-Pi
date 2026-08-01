import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_SEARCH_DEPTH = 7;
const MAX_MATCHES = 128;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "dist-win", "build"]);

function isWithinProject(projectDirectory, candidate) {
  const relative = path.relative(projectDirectory, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isRegularFile(candidate) {
  try {
    return fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function fileDepth(projectDirectory, candidate) {
  const relative = path.relative(projectDirectory, candidate);
  return relative.split(path.sep).length - 1;
}

async function findNamedFiles(projectDirectory, fileName) {
  const matches = [];
  const queue = [{ directory: projectDirectory, depth: 0 }];
  while (queue.length && matches.length < MAX_MATCHES) {
    const { directory, depth } = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        try {
          const stats = await fs.stat(candidate);
          matches.push({ path: candidate, depth: fileDepth(projectDirectory, candidate), modifiedAt: stats.mtimeMs });
        } catch {
          // The file may disappear while the project is being scanned.
        }
      } else if (entry.isDirectory() && depth < MAX_SEARCH_DEPTH && !IGNORED_DIRECTORIES.has(entry.name)) {
        queue.push({ directory: candidate, depth: depth + 1 });
      }
      if (matches.length >= MAX_MATCHES) break;
    }
  }
  return matches;
}

function chooseBestMatch(matches) {
  return [...matches].sort((left, right) => (
    left.depth - right.depth
    || right.modifiedAt - left.modifiedAt
    || left.path.localeCompare(right.path, undefined, { sensitivity: "base" })
  ));
}

export async function resolveProjectFileReference({ cwd, reference }) {
  const projectDirectory = path.resolve(cwd || process.cwd());
  const rawReference = String(reference ?? "").trim().replace(/[.,;:!?，。；：！？]+$/, "");
  if (!rawReference) throw new Error("缺少文件引用");

  const isAbsoluteLocalPath = /^[A-Za-z]:[\\/]/.test(rawReference);
  const hasPath = /[\\/]/.test(rawReference) || isAbsoluteLocalPath;
  if (hasPath) {
    const candidate = isAbsoluteLocalPath ? path.normalize(rawReference) : path.resolve(projectDirectory, rawReference);
    if (!isAbsoluteLocalPath && !isWithinProject(projectDirectory, candidate)) {
      throw new Error("文件路径不在当前项目中");
    }
    if (!isRegularFile(candidate)) throw new Error(`未在当前项目中找到文件：${rawReference}`);
    return { path: candidate, resolvedBy: "path", alternatives: [] };
  }

  const directMatch = path.join(projectDirectory, rawReference);
  if (isRegularFile(directMatch)) return { path: directMatch, resolvedBy: "root", alternatives: [] };

  const matches = chooseBestMatch(await findNamedFiles(projectDirectory, rawReference));
  if (!matches.length) throw new Error(`未在当前项目中找到文件：${rawReference}`);
  return {
    path: matches[0].path,
    resolvedBy: matches.length === 1 ? "search" : "fallback",
    alternatives: matches.slice(1).map((match) => match.path),
  };
}
