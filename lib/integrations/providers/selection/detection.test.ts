/** Verifies exact origin detection, explicit provider selection and failed Git observations at the factory boundary. */

import assert from "node:assert/strict";
import { it } from "node:test";

import type { RunCommand } from "../../../context.js";
import { createProvider } from "./factory.js";

/** Clean Git observation used to exercise provider selection without external commands.
 * @param stdout - External output to deliver to the adapter.
 */
function success(stdout: string): Awaited<ReturnType<RunCommand>> {
  return { stdout, stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
}

it("detects exact known hosts and requires explicit selection for unknown or self-hosted origins", async () => {
  for (const [remote, expected] of [["git@github.com:owner/repo.git", "github"], ["https://gitlab.com/group/repo.git", "gitlab"]]) {
    const result = await createProvider({ repoPath: ".", runCommand: async () => success(remote) });
    assert.equal(result.type, expected);
  }
  for (const remote of ["https://github.com.attacker.test/owner/repo", "git@code.example:group/repo", "local/path", ""]) {
    await assert.rejects(createProvider({ repoPath: ".", runCommand: async () => success(remote) }), /specify.*provider explicitly/);
  }
  await assert.rejects(createProvider({ repoPath: ".", runCommand: async () => ({ ...success(""), code: 128, stderr: "missing origin" }) }));
  let calls = 0;
  const explicit = await createProvider({ provider: "gitlab", repoPath: ".", runCommand: async () => { calls++; throw new Error("must not detect"); } });
  assert.equal(explicit.type, "gitlab");
  assert.equal(calls, 0);
});
