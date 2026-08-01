import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveProjectFileReference } from "../main/project-file-resolver.js";

async function withProject(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "apple-pi-file-resolver-"));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("opens the project-root file before nested files with the same name", async () => {
  await withProject(async (directory) => {
    await fs.mkdir(path.join(directory, "src"));
    await fs.writeFile(path.join(directory, "config.json"), "root");
    await fs.writeFile(path.join(directory, "src", "config.json"), "nested");

    const resolved = await resolveProjectFileReference({ cwd: directory, reference: "config.json" });
    assert.equal(resolved.path, path.join(directory, "config.json"));
    assert.equal(resolved.resolvedBy, "root");
  });
});

test("uses a stable fallback for duplicate bare filenames", async () => {
  await withProject(async (directory) => {
    await fs.mkdir(path.join(directory, "src"));
    await fs.mkdir(path.join(directory, "test"));
    await fs.writeFile(path.join(directory, "src", "widget.ts"), "source");
    await fs.writeFile(path.join(directory, "test", "widget.ts"), "test");
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    await fs.utimes(path.join(directory, "src", "widget.ts"), timestamp, timestamp);
    await fs.utimes(path.join(directory, "test", "widget.ts"), timestamp, timestamp);

    const resolved = await resolveProjectFileReference({ cwd: directory, reference: "widget.ts" });
    assert.equal(resolved.path, path.join(directory, "src", "widget.ts"));
    assert.equal(resolved.resolvedBy, "fallback");
    assert.deepEqual(resolved.alternatives, [path.join(directory, "test", "widget.ts")]);
  });
});

test("keeps an explicit relative path precise", async () => {
  await withProject(async (directory) => {
    await fs.mkdir(path.join(directory, "src"));
    await fs.writeFile(path.join(directory, "src", "widget.ts"), "source");
    await fs.mkdir(path.join(directory, "test"));
    await fs.writeFile(path.join(directory, "test", "widget.ts"), "test");

    const resolved = await resolveProjectFileReference({ cwd: directory, reference: "test/widget.ts" });
    assert.equal(resolved.path, path.join(directory, "test", "widget.ts"));
    assert.equal(resolved.resolvedBy, "path");
  });
});
