/** Exercises session inventory completeness and token normalization through the real adapter. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

import type { RunCommand } from "../../../context.js";
import { fetchGatewaySessions, isSessionAlive } from "./observations.js";

/** Return a clean gateway status acknowledgement carrying the supplied inventory.
 * @param payload - Status JSON used by this isolated transport.
 */
function statusCommand(payload: unknown): RunCommand {
  return async () => ({ stdout: JSON.stringify(payload), stderr: "", code: 0, signal: null, killed: false, termination: "exit" });
}

it("merges recent observations with partial stores without proving absence", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-session-observation-"));
  const file = path.join(directory, "sessions.json");
  t.after(async () => { await fs.unlink(file); await fs.rmdir(directory); });
  await fs.writeFile(file, JSON.stringify({ stored: { updatedAt: 1, totalTokens: 20, contextTokens: 100 } }));
  const lookup = await fetchGatewaySessions(undefined, statusCommand({ sessions: {
    paths: [file, path.join(directory, "missing.json")], recent: [{ key: "recent", updatedAt: 2, percentUsed: 10 }],
  } }));
  assert.ok(lookup);
  assert.equal(lookup.complete, false);
  assert.equal(lookup.sessions.get("stored")?.percentUsed, 20);
  assert.equal(isSessionAlive("stored", lookup), true);
  assert.equal(isSessionAlive("recent", lookup), true);
  assert.equal(isSessionAlive("absent", lookup), null);
});

it("proves absence only after every store and record was successfully read", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-session-observation-"));
  const file = path.join(directory, "sessions.json");
  t.after(async () => { await fs.unlink(file); await fs.rmdir(directory); });
  await fs.writeFile(file, JSON.stringify({ known: { updatedAt: 1 } }));
  const lookup = await fetchGatewaySessions(undefined, statusCommand({ sessions: { paths: [file] } }));
  assert.ok(lookup);
  assert.equal(lookup.complete, true);
  assert.equal(isSessionAlive("absent", lookup), false);
  await fs.writeFile(file, JSON.stringify({ known: { updatedAt: 1 }, invalid: null }));
  const partial = await fetchGatewaySessions(undefined, statusCommand({ sessions: { paths: [file] } }));
  assert.equal(isSessionAlive("known", partial), true);
  assert.equal(isSessionAlive("invalid", partial), null);
});

it("treats a recent-only or corrupt-store inventory as incomplete and prefers newer observations", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-session-observation-"));
  const file = path.join(directory, "sessions.json");
  t.after(async () => { await fs.unlink(file); await fs.rmdir(directory); });
  await fs.writeFile(file, "broken JSON");
  for (const paths of [[], [file]]) {
    const lookup = await fetchGatewaySessions(undefined, statusCommand({ sessions: { paths, recent: [{ key: "known", updatedAt: 1 }] } }));
    assert.equal(isSessionAlive("known", lookup), true);
    assert.equal(isSessionAlive("absent", lookup), null);
  }
  await fs.writeFile(file, JSON.stringify({ known: { updatedAt: 1, totalTokens: 80, contextTokens: 100 } }));
  const newer = await fetchGatewaySessions(undefined, statusCommand({ sessions: {
    paths: [file], recent: [{ key: "known", updatedAt: 2, totalTokens: 20, contextTokens: 100 }],
  } }));
  assert.equal(newer?.sessions.get("known")?.percentUsed, 20);
});

it("keeps unavailable, invalid and stale token metrics unknown", async () => {
  const lookup = await fetchGatewaySessions(undefined, statusCommand({ sessions: { recent: [
    { key: "empty", updatedAt: 1 },
    { key: "zero-capacity", totalTokens: 20, contextTokens: 0 },
    { key: "negative", totalTokens: -20, contextTokens: 100 },
    { key: "invalid", percentUsed: "90" },
    { key: "stale", totalTokens: 90, contextTokens: 100, totalTokensFresh: false },
    { key: "zero-use", totalTokens: 0, contextTokens: 100 },
  ] } }));
  assert.ok(lookup);
  for (const key of ["empty", "zero-capacity", "negative", "invalid", "stale"]) {
    assert.equal(lookup.sessions.get(key)?.percentUsed, undefined);
  }
  assert.equal(lookup.sessions.get("zero-use")?.percentUsed, 0);
  assert.equal(isSessionAlive("absent", null), null);
});

it("does not accept failure output as an authoritative inventory", async () => {
  const runCommand: RunCommand = async () => ({ stdout: '{"sessions":{"paths":[],"recent":[]}}', stderr: "failure",
    code: 1, signal: null, killed: false, termination: "exit" });
  assert.equal(await fetchGatewaySessions(undefined, runCommand), null);
  assert.equal(await fetchGatewaySessions(undefined, async () => { throw new Error("timeout"); }), null);
});
