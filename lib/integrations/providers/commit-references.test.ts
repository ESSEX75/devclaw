/** Verifies safe exact-issue history commands and rejects invalid identities before executing git. */

import assert from "node:assert/strict";
import { it } from "node:test";

import type { RunCommand } from "../../context.js";
import { GitHubProvider } from "./github/index.js";
import { GitLabProvider } from "./gitlab/index.js";

for (const Provider of [GitHubProvider, GitLabProvider]) {
  it(`${Provider.name} matches exact issue references while rejecting numeric prefixes and unrelated MR IDs`, async () => {
    for (const [message, expected] of [["Fix #12", true], ["Fix #123", false], ["Merge !12", false],
      ["Fix #12abc", false], ["Fix ##12", false], ["Body\n#12\n", true]] as const) {
      const runCommand: RunCommand = async argv => {
        const grep = argv.indexOf("--grep");
        assert.ok(grep >= 0);
        // Translate only POSIX's ASCII alnum class for the fixture engine, using the actual requested pattern.
        const requested = new RegExp(argv[grep + 1].replaceAll("[:alnum:]", "A-Za-z0-9"), "m");
        return { stdout: requested.test(message) ? "matching-commit" : "", stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
      };
      assert.equal(await new Provider({ repoPath: ".", runCommand }).isCommitOnBaseBranch(12, "main"), expected, message);
    }
  });

  it(`${Provider.name} asks git for one exact issue reference without an MR fallback or history cap`, async () => {
    const calls: string[][] = [];
    const runCommand: RunCommand = async argv => {
      calls.push([...argv]);
      return { stdout: "", stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
    };
    const provider = new Provider({ repoPath: ".", runCommand });
    assert.equal(await provider.isCommitOnBaseBranch(12, "main"), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "git");
    assert.ok(calls[0].includes("origin/main"));
    assert.ok(calls[0].includes("--extended-regexp"));
    assert.ok(!calls[0].some(arg => arg.includes("!12") || /^-\d+$/.test(arg)));
    assert.equal(calls[0].at(-1), "--");
    await assert.rejects(provider.isCommitOnBaseBranch(0, "main"));
    assert.equal(calls.length, 1);
  });
}
