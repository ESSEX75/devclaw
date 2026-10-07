/** Verifies that current project PR evidence, including failed reads, gates worker completion. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTestHarness } from "../../../testing/index.js";
import { validateFinishPullRequest } from "./finish-preconditions.js";
import { loadFinishWorkContext } from "./finish-context.js";

describe("finish preconditions", () => {
  it("propagates provider authentication and transient failures", async (t) => {
    const h = await createTestHarness();

    try {
      for (const message of ["unauthorized", "service unavailable"]) {
        const fault = t.mock.method(h.provider, "getPrStatus", async () => { throw new Error(message); });

        await assert.rejects(validateFinishPullRequest(h.provider, 42), new RegExp(message));
        fault.mock.restore();
      }

      assert.equal(h.provider.callsTo("addLabels").length, 0);
    } finally { await h.cleanup(); }
  });

  it("uses only the current project's PR even when another project has the same issue number", async () => {
    const left = await createTestHarness();
    const right = await createTestHarness();

    try {
      left.provider.setPrStatus(42, { state: "open", url: "https://left/pr/42", mergeable: false });
      right.provider.setPrStatus(42, { state: "open", url: "https://right/pr/42", mergeable: true });
      await assert.rejects(validateFinishPullRequest(left.provider, 42), /merge conflicts/);
      await validateFinishPullRequest(right.provider, 42);
      left.provider.setPrStatus(42, { state: "open", url: "https://left/pr/42", mergeable: true });
      await validateFinishPullRequest(left.provider, 42);
      for (const state of ["closed", "merged"] as const) {
        left.provider.setPrStatus(42, { state, url: "https://left/pr/42" });
        await assert.rejects(validateFinishPullRequest(left.provider, 42), /without an open PR/);
      }
    } finally { await left.cleanup(); await right.cleanup(); }
  });

  it("does not match a supplied session against an unbound active slot", async () => {
    const h = await createTestHarness({ workers: { developer: { active: true, issueId: 42, level: "medior", sessionKey: null } } });

    try {
      await assert.rejects(loadFinishWorkContext({ workspaceDir: h.workspaceDir, channelId: h.project.channels[0].channelId,
        role: "developer", result: "done", sessionKey: "another-session", runCommand: h.runCommand }), /worker not active/);
    } finally { await h.cleanup(); }
  });
});
