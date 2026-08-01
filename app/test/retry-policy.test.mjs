import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const retryModuleUrl = pathToFileURL(
  path.resolve(testDir, "../node_modules/@earendil-works/pi-ai/dist/utils/retry.js")
).href;
const { isRetryableAssistantError } = await import(retryModuleUrl);

test("treats heap_pressure 503 responses as transient retryable failures", () => {
  const message = {
    stopReason: "error",
    errorMessage: '503: {"message":"Service temporarily under memory pressure. Retry shortly.","type":"server_error","code":"heap_pressure"}',
  };

  assert.equal(isRetryableAssistantError(message), true);
});
