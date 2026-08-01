import assert from "node:assert/strict";
import test from "node:test";
import { extractSessionEvents, historyFromSessionEvents } from "../main/session-history.js";

test("reads concatenated session records without losing conversation history", () => {
  const raw = [
    JSON.stringify({ type: "session", cwd: "D:/project" }),
    JSON.stringify({ type: "message", message: { role: "user", content: "Implement the feature" } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "Inspecting" }, { type: "text", text: "Done" }] } }),
    JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "file contents" }] } }),
  ].join("");

  const history = historyFromSessionEvents(extractSessionEvents(raw));
  assert.deepEqual(history.map((entry) => entry.role), ["user", "thinking", "assistant", "toolResult"]);
  assert.equal(history[0].text, "Implement the feature");
  assert.equal(history[2].text, "Done");
  assert.equal(history[3].result, "file contents");
});

test("ignores an incomplete trailing session record", () => {
  const raw = `${JSON.stringify({ type: "message", message: { role: "user", content: "Saved" } })}\n{\"type\":\"message\"`;
  const history = historyFromSessionEvents(extractSessionEvents(raw));
  assert.deepEqual(history, [{ role: "user", text: "Saved" }]);
});
