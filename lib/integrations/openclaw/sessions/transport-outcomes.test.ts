/** Confirms session effects preserve abnormal completion as uncertainty and never replay gateway mutations. */

import assert from "node:assert/strict";
import { it } from "node:test";

import type { RunCommand } from "../../../context.js";
import { AGENT_TURN_STATUS, deleteWorkerSession, submitAgentTurn } from "./index.js";

/** Clean process evidence varied by each abnormal-completion scenario. */
const completed: Awaited<ReturnType<RunCommand>> = { stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: "exit" };

/** Abnormal process records retain the SDK's concrete signal and termination types. */
const abnormalResults: Awaited<ReturnType<RunCommand>>[] = [
  { ...completed, signal: "SIGTERM" },
  { ...completed, killed: true },
  { ...completed, termination: "timeout" },
  { ...completed, code: null },
];

for (const result of abnormalResults) {
  it(`does not confirm cleanup or turn acceptance from ${JSON.stringify(result)}`, async () => {
    let calls = 0;
    const runCommand: RunCommand = async () => { calls++; return result; };
    await assert.rejects(deleteWorkerSession("agent:owner:subagent:worker", runCommand), /cleanup failed/);
    assert.equal(calls, 1);
    const outcome = await submitAgentTurn("agent:owner:subagent:worker", "Required task context", { submissionId: "immutable-turn", runCommand });
    assert.equal(outcome.kind, AGENT_TURN_STATUS.UNKNOWN);
    assert.equal(calls, 2);
  });
}

it("rejects an empty cleanup identity before invoking the gateway", async () => {
  let calls = 0;
  const runCommand: RunCommand = async () => { calls++; return completed; };
  await assert.rejects(deleteWorkerSession(" ", runCommand), /nonempty exact session key/);
  assert.equal(calls, 0);
});
