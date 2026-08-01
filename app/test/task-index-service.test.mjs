import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeTaskIndex, TaskIndexService } from "../main/task-index-service.js";

test("normalizes duplicate session references", () => {
  const sessionFile = path.join(os.tmpdir(), "desktop-session.jsonl");
  const index = normalizeTaskIndex({
    tasks: [
      { id: "older", sessionFile, updatedAt: 1 },
      { id: "newer", sessionFile: sessionFile.toUpperCase(), updatedAt: 2 },
    ],
    projects: [],
    activeTaskId: "newer",
  });
  assert.equal(index.tasks.length, 1);
  assert.equal(index.tasks[0].id, "newer");
});

test("recovers only sessions owned by the desktop application", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-index-"));
  try {
    const service = new TaskIndexService(root);
    const sessionDirectory = path.join(root, "sessions", "project");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(path.join(sessionDirectory, "owned.jsonl"), [
      JSON.stringify({ type: "session", timestamp: "2026-01-01T00:00:00.000Z", cwd: root }),
      JSON.stringify({ type: "message", message: { role: "user", content: "owned" } }),
    ].join("\n"), "utf8");
    await service.save({ tasks: [], projects: [], activeTaskId: null });

    const recovery = await service.recoverMissingSessions();
    assert.equal(recovery.recoveredCount, 1);
    assert.equal(recovery.index.tasks.length, 1);
  assert.ok(recovery.index.tasks[0].sessionFile.startsWith(service.sessionsRoot));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves task plans and turn metrics during index normalization", () => {
  const index = normalizeTaskIndex({
    tasks: [{
      id: "planned-task",
      sessionFile: path.join(os.tmpdir(), "planned-task.jsonl"),
      plan: { items: [{ text: "Inspect files", done: true }, { text: "Apply change", done: false }] },
      turnMetrics: [{ turn: 0, durationMs: 1250, tokens: 432 }],
      updatedAt: 1,
    }],
    projects: [],
    activeTaskId: "planned-task",
  });
  assert.deepEqual(index.tasks[0].plan.items.map((item) => item.done), [true, false]);
  assert.equal(index.tasks[0].turnMetrics[0].tokens, 432);
});

test("flush waits for the queued index write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-desktop-index-"));
  try {
    const service = new TaskIndexService(root);
    void service.save({ tasks: [{ id: "task-1" }], projects: [], activeTaskId: "task-1" });
    await service.flush();
    const saved = await service.load();
    assert.equal(saved.tasks[0].id, "task-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
