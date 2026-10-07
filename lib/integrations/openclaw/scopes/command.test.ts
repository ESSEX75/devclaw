/** Rejects reassuring scope output after abnormal completion or capture loss; only a clean unsupported response proves absence. */

import assert from "node:assert/strict";
import { it } from "node:test";

import type { RunCommand } from "../../../context.js";
import { runScopeCommand } from "./index.js";

/** Process evidence carrying a CLI-absent diagnostic whose interpretation depends on clean completion. */
const unsupported: Awaited<ReturnType<RunCommand>> = {
  stdout: "", stderr: "unknown command 'scopes'", code: 1, signal: null, killed: false, termination: "exit",
};

it("recognizes absent scope CLI support only after a normal observed exit", async () => {
  assert.deepEqual(await runScopeCommand(async () => unsupported, ["workspace:read"]), { supported: false });
});

/** Abnormal transport evidence cannot establish that required approval support is unavailable. */
const uncertain: Awaited<ReturnType<RunCommand>>[] = [
  { ...unsupported, signal: "SIGTERM" },
  { ...unsupported, killed: true },
  { ...unsupported, termination: "timeout", code: null },
  { ...unsupported, stderrTruncatedBytes: 3 },
  { ...unsupported, stdout: '{"ok":true,"approved":["workspace:read"]}', code: 0, stdoutTruncatedBytes: 10 },
];

for (const response of uncertain) {
  it(`propagates an uncertain scope request instead of reporting unsupported or approved: ${JSON.stringify(response)}`, async () => {
    let calls = 0;
    await assert.rejects(runScopeCommand(async () => { calls++; return response; }, ["workspace:read"], "Exact owner request"), /clean completion/);
    assert.equal(calls, 1);
  });
}
