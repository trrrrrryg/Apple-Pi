import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const TASK_INDEX_FILE = "task-index.json";
const MAX_RECOVERED_SESSION_FILES = 10_000;
const SESSION_METADATA_READ_LIMIT = 256 * 1024;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedPath(value) {
  return typeof value === "string" && value.trim()
    ? path.resolve(value).replace(/[\\/]+$/, "").toLowerCase()
    : "";
}

function stableId(prefix, value) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function uniqueTaskId(preferredId, sessionKey, usedTaskIds) {
  if (!usedTaskIds.has(preferredId)) return preferredId;
  let attempt = 1;
  let candidate = stableId("recovered-task", `${sessionKey}:${attempt}`);
  while (usedTaskIds.has(candidate)) {
    attempt += 1;
    candidate = stableId("recovered-task", `${sessionKey}:${attempt}`);
  }
  return candidate;
}

function repairDuplicateTaskIds(tasks, availableSessionFiles) {
  const deduplicated = [];
  const taskIndexById = new Map();
  let repairedCount = 0;

  for (const originalTask of tasks) {
    const task = { ...originalTask };
    const sessionKey = normalizedPath(task.sessionFile);
    const existingIndex = typeof task.id === "string" ? taskIndexById.get(task.id) : undefined;
    if (existingIndex === undefined) {
      taskIndexById.set(task.id, deduplicated.length);
      deduplicated.push(task);
      continue;
    }

    const existingTask = deduplicated[existingIndex];
    const existingSessionKey = normalizedPath(existingTask.sessionFile);
    const existingAvailable = existingSessionKey && availableSessionFiles.has(existingSessionKey);
    const currentAvailable = sessionKey && availableSessionFiles.has(sessionKey);

    if (existingSessionKey === sessionKey || (!existingSessionKey && !sessionKey)) {
      if ((task.updatedAt || 0) > (existingTask.updatedAt || 0)) deduplicated[existingIndex] = task;
      repairedCount += 1;
      continue;
    }
    if (existingAvailable && !currentAvailable) {
      repairedCount += 1;
      continue;
    }
    if (!existingAvailable && currentAvailable) {
      deduplicated[existingIndex] = task;
      repairedCount += 1;
      continue;
    }

    // Two separate, still-valid sessions may have inherited one task id after
    // a prior recovery. Keep both histories, but give the later item its own id.
    task.id = uniqueTaskId(task.id, sessionKey || `${task.title}:${task.createdAt}`, taskIndexById);
    taskIndexById.set(task.id, deduplicated.length);
    deduplicated.push(task);
    repairedCount += 1;
  }
  return { tasks: deduplicated, repairedCount };
}

function extractJsonObjects(raw) {
  const result = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (start < 0) {
      if (/\s/.test(character)) continue;
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          result.push(JSON.parse(raw.slice(start, index + 1)));
        } catch {
          // A partially written session must never prevent other histories restoring.
        }
        start = -1;
      }
    }
  }
  return result;
}

function textFromMessageContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ");
}

function taskTitleFromText(value) {
  const plain = String(value ?? "")
    .replace(/<pi-system-instruction>[\s\S]*?<\/pi-system-instruction>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 80) || "已恢复对话";
}

async function listSessionFiles(root) {
  const files = [];
  const pendingDirectories = [root];
  while (pendingDirectories.length > 0 && files.length < MAX_RECOVERED_SESSION_FILES) {
    const directory = pendingDirectories.pop();
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pendingDirectories.push(candidate);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) files.push(candidate);
      if (files.length >= MAX_RECOVERED_SESSION_FILES) break;
    }
  }
  return files;
}

async function readSessionSummary(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(SESSION_METADATA_READ_LIMIT);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const events = extractJsonObjects(buffer.subarray(0, bytesRead).toString("utf8"));
    const session = events.find((event) => event?.type === "session");
    if (!session || typeof session.cwd !== "string" || !session.cwd.trim()) return null;
    const firstUserMessage = events.find((event) => event?.type === "message" && event.message?.role === "user");
    const stat = await handle.stat();
    const startedAt = Date.parse(session.timestamp);
    const timestamp = Number.isFinite(startedAt) ? startedAt : stat.mtimeMs;
    return {
      filePath,
      cwd: session.cwd,
      title: taskTitleFromText(textFromMessageContent(firstUserMessage?.message?.content)),
      createdAt: timestamp,
      updatedAt: stat.mtimeMs,
    };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * The task index is navigation metadata only. Messages remain in Pi's JSONL
 * sessions, so a damaged index must never make a session file disposable.
 */
export function normalizeTaskIndex(value) {
  if (!isPlainObject(value)) return { tasks: [], projects: [], activeTaskId: null };
  const candidates = Array.isArray(value.tasks) ? value.tasks.filter(isPlainObject).slice(0, 10000) : [];
  const tasks = [];
  const taskIndexByKey = new Map();
  for (const task of candidates) {
    const key = normalizedPath(task.sessionFile) || `id:${task.id}`;
    const existingIndex = taskIndexByKey.get(key);
    if (existingIndex === undefined) {
      taskIndexByKey.set(key, tasks.length);
      tasks.push(task);
    } else if ((task.updatedAt || 0) >= (tasks[existingIndex].updatedAt || 0)) {
      tasks[existingIndex] = task;
    }
  }
  return {
    schemaVersion: 2,
    tasks,
    projects: Array.isArray(value.projects) ? value.projects.filter(isPlainObject).slice(0, 5000) : [],
    activeTaskId: typeof value.activeTaskId === "string" ? value.activeTaskId : null,
  };
}

export class TaskIndexService {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, TASK_INDEX_FILE);
    this.sessionsRoot = path.join(userDataPath, "sessions");
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      return normalizeTaskIndex(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Unable to load task index backup:", error);
      return { tasks: [], projects: [], activeTaskId: null };
    }
  }

  async save(index) {
    const normalized = normalizeTaskIndex(index);
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(() => this._write(normalized));
    return this.writeQueue;
  }

  async flush() {
    await this.writeQueue;
  }

  /**
   * Rebuild missing sidebar entries from Pi session files without altering any
   * existing task, project, or session file. Pi writes concatenated JSON
   * records, so this deliberately does not assume one JSON object per line.
   */
  async recoverMissingSessions() {
    const normalizedIndex = await this.load();
    const recoveredIndex = {
      ...normalizedIndex,
      tasks: normalizedIndex.tasks.map((task) => ({ ...task })),
      projects: normalizedIndex.projects.map((project) => ({ ...project })),
    };
    const sessionFiles = await listSessionFiles(this.sessionsRoot);
    const availableSessionFiles = new Set(sessionFiles.map(normalizedPath).filter(Boolean));
    const repaired = repairDuplicateTaskIds(recoveredIndex.tasks, availableSessionFiles);
    recoveredIndex.tasks = repaired.tasks;
    const knownSessionFiles = new Set(
      recoveredIndex.tasks
        .map((task) => normalizedPath(task.sessionFile))
        .filter(Boolean)
    );
    const projectIdByPath = new Map(
      recoveredIndex.projects
        .map((project) => [normalizedPath(project.path), project.id])
        .filter(([projectPath, projectId]) => projectPath && typeof projectId === "string")
    );
    const usedTaskIds = new Set(recoveredIndex.tasks.map((task) => task.id).filter((id) => typeof id === "string"));
    let recoveredCount = 0;

    for (const sessionFile of sessionFiles) {
      const key = normalizedPath(sessionFile);
      if (!key || knownSessionFiles.has(key)) continue;
      const summary = await readSessionSummary(sessionFile);
      if (!summary) continue;

      const projectPath = normalizedPath(summary.cwd);
      let projectId = null;
      if (projectPath) {
        projectId = projectIdByPath.get(projectPath);
        if (!projectId) {
          projectId = stableId("recovered-project", projectPath);
          projectIdByPath.set(projectPath, projectId);
          recoveredIndex.projects.push({
            id: projectId,
            path: summary.cwd,
            name: path.basename(summary.cwd.replace(/[\\/]+$/, "")) || summary.cwd,
            createdAt: summary.createdAt,
          });
        }
      }

      const taskId = uniqueTaskId(stableId("recovered-task", key), key, usedTaskIds);
      usedTaskIds.add(taskId);
      recoveredIndex.tasks.push({
        id: taskId,
        title: summary.title,
        projectId,
        sessionFile: summary.filePath,
        status: "idle",
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        recoveredAt: Date.now(),
      });
      knownSessionFiles.add(key);
      recoveredCount += 1;
    }

    return { index: recoveredIndex, recoveredCount, repairedCount: repaired.repairedCount, scannedCount: sessionFiles.length };
  }

  async _write(normalized) {
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(normalized, null, 2), "utf8");
      await fs.rename(temporaryPath, this.filePath);
    } finally {
      await fs.unlink(temporaryPath).catch(() => {});
    }
    return normalized;
  }
}
