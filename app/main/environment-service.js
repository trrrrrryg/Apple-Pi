import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { detectLocalModelRuntimes } from "./local-model-service.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 2500;

function firstLine(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

async function probeCommand(candidates, unavailableDetail) {
  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate.command, candidate.args, {
        windowsHide: true,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      });
      return {
        state: "ready",
        detail: firstLine(stdout) || firstLine(stderr) || candidate.successDetail,
      };
    } catch {
      // Only fixed executable names are probed; no user supplied command is run.
    }
  }
  return { state: "missing", detail: unavailableDetail };
}

async function readPackageInfo(appPath) {
  try {
    return JSON.parse(await readFile(path.join(appPath, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function bundledEntry(id, name, detail) {
  return { id, group: "bundled", required: true, state: "ready", name, detail };
}

function localRuntimeEntry(runtime) {
  const modelCount = Array.isArray(runtime.models) ? runtime.models.length : 0;
  return {
    id: `local-${runtime.id}`,
    group: "optional",
    required: false,
    state: runtime.available ? "ready" : "not-running",
    name: `${runtime.name} 本地服务`,
    detail: runtime.available
      ? `正在运行${modelCount ? `，已发现 ${modelCount} 个模型` : "，暂未返回模型"}`
      : "未检测到正在运行的本地服务",
  };
}

export async function getEnvironmentStatus({ appVersion, appPath } = {}) {
  const packageInfo = await readPackageInfo(appPath || process.cwd());
  const piVersion = packageInfo.dependencies?.["@earendil-works/pi-coding-agent"] ?? "已内置";
  const [powerShell, git, python, ollama, localRuntimes] = await Promise.all([
    probeCommand(
      process.platform === "win32"
        ? [{ command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], successDetail: "可用" }]
        : [{ command: "pwsh", args: ["--version"], successDetail: "可用" }],
      "未检测到 PowerShell",
    ),
    probeCommand(
      [{ command: "git", args: ["--version"], successDetail: "可用" }],
      "未安装，可选用于 Git 改动审查",
    ),
    probeCommand(
      [
        { command: "py", args: ["--version"], successDetail: "可用" },
        { command: "python", args: ["--version"], successDetail: "可用" },
      ],
      "未安装，可选用于 Python 脚本和部分 Skill",
    ),
    probeCommand(
      [{ command: "ollama", args: ["--version"], successDetail: "已安装" }],
      "未安装，可选用于本地模型",
    ),
    detectLocalModelRuntimes(),
  ]);

  const entries = [
    bundledEntry("apple-pi", "苹果Pi 桌面应用", `版本 ${appVersion || packageInfo.version || "未知"}`),
    bundledEntry("electron", "Electron 桌面运行时", `版本 ${process.versions.electron || "已内置"}`),
    bundledEntry("node", "Node.js 运行时", `版本 ${process.versions.node || "已内置"}`),
    bundledEntry("pi-sdk", "Pi Agent 引擎", `版本 ${String(piVersion).replace(/^\^/, "")}`),
    {
      id: "operating-system",
      group: "system",
      required: true,
      state: process.platform === "win32" ? "ready" : "missing",
      name: "Windows 系统环境",
      detail: process.platform === "win32" ? `Windows ${os.release()}` : "当前安装包仅支持 Windows",
    },
    { id: "powershell", group: "system", required: true, name: "PowerShell", ...powerShell },
    { id: "git", group: "optional", required: false, name: "Git", ...git },
    { id: "python", group: "optional", required: false, name: "Python", ...python },
    { id: "ollama", group: "optional", required: false, name: "Ollama", ...ollama },
    ...(localRuntimes || []).filter((runtime) => runtime.id !== "ollama").map(localRuntimeEntry),
  ];

  const requiredEntries = entries.filter((entry) => entry.required);
  return {
    checkedAt: Date.now(),
    allRequiredReady: requiredEntries.every((entry) => entry.state === "ready"),
    requiredReady: requiredEntries.filter((entry) => entry.state === "ready").length,
    requiredTotal: requiredEntries.length,
    entries,
  };
}
