/**
 * Verifies atomic state-file replacement and temporary-file cleanup.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { writeJsonAtomic } from "./atomic-file.js";

/** Temporary directories removed after each atomic-write test. */
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })));
});

describe("writeJsonAtomic", () => {
  it("replaces JSON and leaves no sibling temporary file", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-atomic-file-"));
    const filePath = path.join(directory, "state.json");

    temporaryDirectories.push(directory);
    await writeJsonAtomic(filePath, { current: true });

    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf-8")), { current: true });
    assert.deepEqual(await fs.readdir(directory), ["state.json"]);
  });
});
