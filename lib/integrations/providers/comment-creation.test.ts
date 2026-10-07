/** Verifies that comment creation is submitted once and preserves unknown mutation outcomes. */

import assert from "node:assert/strict";
import { it } from "node:test";

import type { RunCommand } from "../../context.js";
import { GitHubProvider } from "./github/index.js";
import { GitLabProvider } from "./gitlab/index.js";
import { isProviderOperationError } from "./guards.js";

/** Real provider adapters exercised through deterministic CLI responses. */
const providers = [GitHubProvider, GitLabProvider];

for (const Provider of providers) {
  it(`${Provider.name} never replays a comment after a lost response`, async () => {
    let submissions = 0;
    const runCommand: RunCommand = async () => {
      submissions++;
      if (submissions === 1) throw new Error("timeout after server created comment");
      return { stdout: '{"id":7}', stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
    };
    const provider = new Provider({ repoPath: ".", runCommand });
    await assert.rejects(provider.addComment(42, "feedback"), error => isProviderOperationError(error) && error.outcomeUnknown);
    assert.equal(submissions, 1);
  });

  it(`${Provider.name} validates comment identity without replaying malformed success`, async () => {
    for (const stdout of ["invalid JSON", "{}", '{"id":-1}', '{"id":"7"}']) {
      let submissions = 0;
      const runCommand: RunCommand = async () => {
        submissions++;
        return { stdout, stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
      };
      const provider = new Provider({ repoPath: ".", runCommand });
      await assert.rejects(provider.addComment(42, "feedback"), error =>
        isProviderOperationError(error) && error.outcomeUnknown && !error.retryable);
      assert.equal(submissions, 1);
    }
  });

  it(`${Provider.name} returns the confirmed ID after one successful submission`, async () => {
    const calls: string[][] = [];
    const runCommand: RunCommand = async argv => {
      calls.push([...argv]);
      return { stdout: '{"id":7}', stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
    };
    assert.equal(await new Provider({ repoPath: ".", runCommand }).addComment(42, "feedback"), 7);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("POST"));
    assert.ok(calls[0].includes("body=feedback"));
  });

  it(`${Provider.name} treats abnormal completion as unknown even with a valid response ID`, async () => {
    let submissions = 0;
    const runCommand: RunCommand = async () => {
      submissions++;
      return { stdout: '{"id":7}', stderr: "", code: null, signal: "SIGTERM", killed: true, termination: "timeout" };
    };
    await assert.rejects(new Provider({ repoPath: ".", runCommand }).addComment(42, "feedback"), error =>
      isProviderOperationError(error) && error.outcomeUnknown);
    assert.equal(submissions, 1);
  });
}
