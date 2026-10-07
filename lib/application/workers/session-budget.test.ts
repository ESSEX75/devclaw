/** Verifies application-owned context reset policy and same-issue feedback preservation. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import type { RunCommand } from "../../context.js";
import { DATA_DIR, loadConfig } from "../../state/index.js";
import { shouldClearSession } from "./session-budget.js";

/** Return a clean gateway status acknowledgement for application policy observations.
 * @param payload - Gateway observation supplied by the fixture.
 */
function statusCommand(payload: unknown): RunCommand {
  return async () => ({ stdout: JSON.stringify(payload), stderr: "", code: 0, signal: null, killed: false, termination: "exit" });
}

it("only resets context above its budget and preserves same-issue feedback", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-session-budget-"));
  t.after(async () => {
    const audit = path.join(directory, "devclaw", "log", "audit.log");
    await fs.unlink(audit);
    await fs.rmdir(path.dirname(audit));
    await fs.rmdir(path.join(directory, "devclaw"));
    await fs.rmdir(directory);
  });
  const { timeouts } = await loadConfig(directory);
  const observe = (totalTokens: number) => statusCommand({ sessions: { recent: [{ key: "worker", totalTokens, contextTokens: 100 }] } });
  assert.equal(await shouldClearSession("worker", 1, 2, timeouts, directory, "project", observe(20)), false);
  assert.equal(await shouldClearSession("worker", 1, 2, timeouts, directory, "project", observe(80)), true);
  assert.equal(await shouldClearSession("worker", 2, 2, timeouts, directory, "project", observe(80)), false);
  const entry: unknown = JSON.parse((await fs.readFile(path.join(directory, DATA_DIR, "log", "audit.log"), "utf8")).trim());
  assert.ok(typeof entry === "object" && entry !== null && "event" in entry && "sessionKey" in entry && "percentUsed" in entry && "threshold" in entry);
  assert.equal(entry.event, "session_budget_reset");
  assert.equal(entry.sessionKey, "worker");
  assert.equal(entry.percentUsed, 80);
  assert.equal(entry.threshold, timeouts.sessionContextBudget * 100);

});

for (const observation of [
  { key: "worker", totalTokens: 80, contextTokens: 100 },
  { key: "worker" },
  { key: "worker", totalTokens: 90, contextTokens: 100, totalTokensFresh: false },
  { key: "another-worker", totalTokens: 100, contextTokens: 100 },
]) {
  it(`retains the session without a reset audit when budget evidence is insufficient: ${JSON.stringify(observation)}`, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-session-policy-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const timeouts = { ...(await loadConfig(directory)).timeouts, sessionContextBudget: 0.8 };
    const reset = await shouldClearSession("worker", 1, 2, timeouts, directory, "project",
      statusCommand({ sessions: { recent: [observation] } }));
    assert.equal(reset, false);
    await assert.rejects(fs.stat(path.join(directory, DATA_DIR)), { code: "ENOENT" });
  });
}

it("preserves same-issue context without observing the gateway or writing an audit", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-session-policy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { timeouts } = await loadConfig(directory);
  let reads = 0;
  const runCommand: RunCommand = async () => { reads++; throw new Error("should never query"); };
  assert.equal(await shouldClearSession("worker", 2, 2, timeouts, directory, "project", runCommand), false);
  assert.equal(reads, 0);
  await assert.rejects(fs.stat(path.join(directory, DATA_DIR)), { code: "ENOENT" });
});

it("retains the session when gateway observation fails", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-session-policy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { timeouts } = await loadConfig(directory);
  assert.equal(await shouldClearSession("worker", 1, 2, timeouts, directory, "project", async () => { throw new Error("gateway unavailable"); }), false);

});
