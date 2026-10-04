/** Injects failures across worker resolution effects and verifies exact-attempt restart recovery. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { describe, it } from "node:test";
import type { RunCommand } from "../../../context.js";
import { WORKER_DELIVERY_RESOLUTION, WORKER_DELIVERY_STATUS } from "../../../domain/index.js";
import { readIssueStateStore, readWorkerDeliveryResolution, updateSlot } from "../../../state/index.js";
import { createTestHarness, type TestHarness } from "../../../testing/index.js";
import { dispatchTask } from "../dispatch/index.js";
import { settleDispatchDelivery } from "../dispatch/delivery-settlement.js";
import { resolveWorkerDelivery } from "./resolve-delivery.js";
import type { DispatchOpts } from "../dispatch/index.js";
import type { ResolveWorkerDeliveryInput } from "./types.js";

/** Build an uncertain dispatch without a real gateway.
 * @param h - Temporary project and provider fixture.
 */
function dispatchInput(h: TestHarness): DispatchOpts {
  const runCommand: RunCommand = async (argv, options) => argv[3] === "agent"
    ? { stdout: "", stderr: "lost response", code: 1, signal: null, killed: false, termination: "exit" }
    : h.runCommand(argv, options);

  return { workspaceDir: h.workspaceDir, project: h.project, agentId: h.project.agentId,
    issueId: 42, issueTitle: "Task", issueDescription: "Task", issueUrl: "https://example.com/42",
    role: "developer", level: "medior", slotIndex: 0, fromLabel: "To Do", toLabel: "Doing", provider: h.provider, runCommand };
}

/** Reserve a real slot and return an exact operator request.
 * @param h - Temporary project whose seeded issue is dispatched.
 */
async function resolutionInput(h: TestHarness): Promise<ResolveWorkerDeliveryInput> {
  h.provider.seedIssue({ iid: 42, labels: ["To Do"] });
  const dispatched = await dispatchTask(dispatchInput(h));

  return { workspaceDir: h.workspaceDir, projectSlug: h.project.slug, issueId: 42,
    deliveryId: dispatched.deliveryId, sessionKey: dispatched.sessionKey,
    decision: WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED, reason: "Operator verified no accepted turn",
    apply: true, workflow: h.workflow, provider: h.provider };
}

describe("durable worker resolution", () => {
  for (const failedWrite of [1, 2, 3, 4]) {
    it(`resumes non-start after failure at durable write ${failedWrite}`, async (t) => {
      const h = await createTestHarness();

      try {
        const input = await resolutionInput(h);
        const rename = fs.rename.bind(fs);
        let writes = 0;
        const fault = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
          if (++writes === failedWrite) throw new Error("injected disk failure");

          return rename(...args);
        });

        await assert.rejects(resolveWorkerDelivery(input), /injected disk failure/);
        fault.mock.restore();
        const pending = await readWorkerDeliveryResolution(h.workspaceDir, h.project.slug, 42);

        assert.equal(pending?.completed, failedWrite === 1 ? undefined : false);
        if (failedWrite === 1) assert.ok((await h.provider.getIssue(42)).labels.includes("Doing"));
        await resolveWorkerDelivery(input);
        const transitions = h.provider.callsTo("transitionLabel").length;

        await resolveWorkerDelivery(input);
        assert.equal(h.provider.callsTo("transitionLabel").length, transitions);
        assert.equal((await readWorkerDeliveryResolution(h.workspaceDir, h.project.slug, 42))?.completed, true);
        assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].activeWorker, null);
        assert.equal((await h.readProjects()).projects[h.project.slug].workers.developer.levels.medior?.[0]?.active, false);
      } finally { await h.cleanup(); }
    });
  }

  it("resumes a started decision after clearing only the slot marker", async (t) => {
    const h = await createTestHarness();

    try {
      const input = { ...await resolutionInput(h), decision: WORKER_DELIVERY_RESOLUTION.CONFIRMED_STARTED };
      const rename = fs.rename.bind(fs);
      let writes = 0;
      const fault = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
        if (++writes === 3) throw new Error("issue write failed");

        return rename(...args);
      });

      await assert.rejects(resolveWorkerDelivery(input), /issue write failed/);
      fault.mock.restore();
      await resolveWorkerDelivery(input);
      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"];

      assert.equal(state.activeWorker?.sessionKey, input.sessionKey);
      assert.equal(state.activeWorker?.delivery, undefined);
      assert.equal(state.workflowLabel, "Doing");
    } finally { await h.cleanup(); }
  });

  it("does not repeat a provider transition after its response was lost", async (t) => {
    const h = await createTestHarness();

    try {
      const input = await resolutionInput(h);
      const transition = h.provider.transitionLabel.bind(h.provider);
      const fault = t.mock.method(h.provider, "transitionLabel", async (...args: Parameters<typeof transition>) => {
        await transition(...args);
        throw new Error("response lost");
      });

      await assert.rejects(resolveWorkerDelivery(input), /response lost/);
      fault.mock.restore();
      const calls = h.provider.callsTo("transitionLabel").length;

      await resolveWorkerDelivery(input);
      assert.equal(h.provider.callsTo("transitionLabel").length, calls);
    } finally { await h.cleanup(); }
  });

  it("rejects a replacement slot without provider effects or slot release", async (t) => {
    const h = await createTestHarness();

    try {
      const input = await resolutionInput(h);
      const fault = t.mock.method(h.provider, "transitionLabel", async () => { throw new Error("provider unavailable"); });

      await assert.rejects(resolveWorkerDelivery(input), /provider unavailable/);
      fault.mock.restore();
      await updateSlot(h.workspaceDir, h.project.slug, "developer", "medior", 0, (slot) => ({ ...slot, sessionKey: "replacement" }));
      const calls = h.provider.callsTo("transitionLabel").length;

      await assert.rejects(resolveWorkerDelivery(input), /replacement delivery/);
      assert.equal(h.provider.callsTo("transitionLabel").length, calls);
      assert.equal((await h.readProjects()).projects[h.project.slug].workers.developer.levels.medior?.[0]?.sessionKey, "replacement");
    } finally { await h.cleanup(); }
  });

  it("fences an old acceptance callback after operator recovery and session reuse", async () => {
    const h = await createTestHarness();

    try {
      const input = await resolutionInput(h);
      const previous = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].activeWorker;

      assert.ok(previous);
      await resolveWorkerDelivery(input);
      const next = await dispatchTask(dispatchInput(h));

      assert.equal(next.sessionKey, input.sessionKey);
      assert.notEqual(next.deliveryId, input.deliveryId);
      await settleDispatchDelivery(dispatchInput(h), {
        role: "developer", level: "medior", slotIndex: 0, sessionKey: input.sessionKey,
        deliveryId: input.deliveryId, startedAt: previous.startedAt, model: "test", botName: "test",
        sessionAction: "send", sessionKeyToDelete: null,
      }, { comments: [], isConflictFix: false, taskMessage: "task", roleInstructions: "" }, { kind: "accepted" });
      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"];

      assert.equal(state.activeWorker?.delivery?.operationId, next.deliveryId);
      assert.equal(state.activeWorker?.delivery?.status, WORKER_DELIVERY_STATUS.UNKNOWN);
      await assert.rejects(resolveWorkerDelivery({ ...input, deliveryId: "wrong" }), /operation ID/);
    } finally { await h.cleanup(); }
  });
});
