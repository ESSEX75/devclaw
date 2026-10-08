/** Verifies completion actions preserve explicit PR identity through merge and ambiguous response recovery. */

import assert from "node:assert/strict";
import { it } from "node:test";

import { ACTION } from "../../domain/index.js";
import { PR_STATE } from "../../integrations/providers/contracts/index.js";
import { createTestHarness } from "../../testing/index.js";
import { executeCompletionActions } from "./provider-actions.js";

for (const failed of [false, true]) {
  it(`retains the requested PR when a newer merged PR exists${failed ? " and the merge response is lost" : ""}`, async () => {
    const h = await createTestHarness();
    const selected = "https://example.test/pr/1";
    const reads: (string | undefined)[] = [];
    const merges: (string | undefined)[] = [];
    h.provider.getPrStatus = async (_issueId, prUrl?: string) => {
      reads.push(prUrl);
      return prUrl ? { state: PR_STATE.OPEN, url: prUrl, mergeable: true }
        : { state: PR_STATE.MERGED, url: "https://example.test/pr/2" };
    };
    h.provider.mergePr = async (_issueId, prUrl?: string) => {
      merges.push(prUrl);
      if (failed) throw new Error("merge response lost");
    };
    try {
      const run = executeCompletionActions({ workspaceDir: h.workspaceDir, projectSlug: h.project.slug, projectName: h.project.name,
        channels: h.project.channels, issueId: 42, role: "tester", result: "pass", provider: h.provider,
        repoPath: h.project.repo, runCommand: h.runCommand, prUrl: selected },
      { from: "Testing", to: "Done", actions: [ACTION.MERGE_PR] }, 1_000);
      if (failed) await assert.rejects(run, /merge response lost/);
      else assert.equal((await run).prUrl, selected);
      assert.deepEqual(merges, [selected]);
      assert.ok(reads.length > 0 && reads.every(url => url === selected));
    } finally { await h.cleanup(); }
  });
}
