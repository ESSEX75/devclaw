/**
 * Verifies token ownership, serialization, stale recovery, and failure cleanup for state locks.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { withFileLock } from "./file-lock.js";

/** Lock policy used by ordinary persistence primitive tests. */
const LOCK_OPTIONS = { retryMs: 5, staleMs: 1_000, timeoutMs: 500 };

/** Temporary directories removed after each persistence primitive test. */
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })));
});

/** Create an isolated lock path and register its directory for cleanup. */
async function createLockPath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-file-lock-"));

  temporaryDirectories.push(directory);

  return path.join(directory, "state.lock");
}

describe("withFileLock", () => {
  it("serializes operations contending for one path", async () => {
    const lockPath = await createLockPath();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withFileLock(lockPath, LOCK_OPTIONS, async () => {
      events.push("first:start");
      await firstMayFinish;
      events.push("first:end");
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = withFileLock(lockPath, LOCK_OPTIONS, () => {
      events.push("second");
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(events, ["first:start"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first:start", "first:end", "second"]);
  });

  it("releases its lock after the operation fails", async () => {
    const lockPath = await createLockPath();

    await assert.rejects(withFileLock(lockPath, LOCK_OPTIONS, () => {
      throw new Error("failed operation");
    }), /failed operation/);
    assert.equal(await withFileLock(lockPath, LOCK_OPTIONS, () => "recovered"), "recovered");
  });

  it("recovers a stale strict lock record", async () => {
    const lockPath = await createLockPath();

    await fs.writeFile(lockPath, JSON.stringify({ token: "abandoned", createdAt: Date.now() - 2_000 }), "utf-8");
    const staleTime = new Date(Date.now() - 2_000);

    await fs.utimes(lockPath, staleTime, staleTime);
    assert.equal(await withFileLock(lockPath, LOCK_OPTIONS, () => "recovered"), "recovered");
  });

  it("renews a live lease while an operation exceeds staleMs", async () => {
    const lockPath = await createLockPath();
    const options = { retryMs: 5, staleMs: 30, timeoutMs: 500 };
    const events: string[] = [];
    const first = withFileLock(lockPath, options, async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 90));
      events.push("first:end");
    });

    await new Promise((resolve) => setTimeout(resolve, 45));
    const second = withFileLock(lockPath, options, () => {
      events.push("second");
    });

    await Promise.all([first, second]);
    assert.deepEqual(events, ["first:start", "first:end", "second"]);
  });

  it("does not remove a replacement lock owned by another token", async () => {
    const lockPath = await createLockPath();

    await withFileLock(lockPath, LOCK_OPTIONS, async () => {
      await fs.writeFile(lockPath, JSON.stringify({ token: "replacement", createdAt: Date.now() }), "utf-8");
    });
    const persisted = JSON.parse(await fs.readFile(lockPath, "utf-8"));

    assert.equal(persisted.token, "replacement");
  });
});
