/** Tests worker reservation safety across gateway rejection, uncertainty, and contention. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import type { RunCommand } from "../../context.js";
import { WORKER_DELIVERY_STATUS } from "../../domain/index.js";
import { checkWorkerHealth } from "../heartbeat/health.js";
import { summarizeTaskIssue } from "../tasks/projection-summary.js";
import { getRoleWorker, updateIssueRuntimeRecord, updateSlot } from "../../state/index.js";
import { readIssueStateStore } from "../../state/index.js";
import { createTestHarness } from "../../testing/index.js";
import { dispatchTask } from "./dispatch-task.js";
import { WORKER_DELIVERY_RESOLUTION } from "./const.js";
import { resolveWorkerDelivery } from "./resolve-delivery.js";

/** Build a dispatch input for a seeded issue in the temporary project. */
function dispatchInput(h: Awaited<ReturnType<typeof createTestHarness>>, issueId: number, runCommand: RunCommand) {
  return {
    workspaceDir: h.workspaceDir, agentId: h.project.agentId, project: h.project,
    issueId, issueTitle: `Issue ${issueId}`, issueDescription: "Task", issueUrl: `https://example.test/${issueId}`,
    role: "developer", level: "medior", fromLabel: "To Do", toLabel: "Doing",
    provider: h.provider, runCommand, slotIndex: 0,
  };
}

describe("worker delivery outcome", () => {
  it("releases the slot and restores provider label after local submission rejection", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 61, labels: ["To Do"] });
    try {
      await assert.rejects(dispatchTask({ ...dispatchInput(h, 61, h.runCommand), agentId: "" }), /invalid local submission input/);
      const project = (await h.readProjects()).projects[h.project.slug];

      assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.issueId, null);
      assert.ok((await h.provider.getIssue(61)).labels.includes("To Do"));
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["61"], undefined);
    } finally {
      await h.cleanup();
    }
  });

  it("retains ownership after a nonzero gateway command exit", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 66, labels: ["To Do"] });
    const runCommand: RunCommand = async (argv, options) => argv[3] === "agent"
      ? { stdout: "", stderr: "response failed", code: 1, signal: null, killed: false, termination: "exit" }
      : h.runCommand(argv, options);

    try {
      const result = await dispatchTask(dispatchInput(h, 66, runCommand));
      const project = (await h.readProjects()).projects[h.project.slug];

      assert.equal(result.deliveryStatus, "unknown");
      assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.issueId, 66);
      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["66"];

      assert.equal(state.activeWorker?.sessionKey, result.sessionKey);
      assert.equal(state.activeWorker?.delivery?.status, WORKER_DELIVERY_STATUS.UNKNOWN);
      assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.delivery?.status, WORKER_DELIVERY_STATUS.UNKNOWN);
      assert.ok((await h.provider.getIssue(66)).labels.includes("Doing"));
    } finally {
      await h.cleanup();
    }
  });

  it("keeps ownership after a lost gateway response and does not resend", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 62, labels: ["To Do"] });
    let sends = 0;
    const runCommand: RunCommand = async (argv, options) => {
      if (argv[3] === "agent") {
        sends++;
        throw new Error("gateway response lost");
      }
      return h.runCommand(argv, options);
    };

    try {
      const result = await dispatchTask(dispatchInput(h, 62, runCommand));
      const project = (await h.readProjects()).projects[h.project.slug];
      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["62"];

      assert.equal(result.deliveryStatus, "unknown");
      assert.equal(sends, 1);
      assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.issueId, 62);
      assert.equal(state.activeWorker?.sessionKey, result.sessionKey);
      assert.equal(state.activeWorker?.delivery?.status, WORKER_DELIVERY_STATUS.UNKNOWN);
      assert.ok((await h.provider.getIssue(62)).labels.includes("Doing"));
      const audit = await fs.readFile(path.join(h.workspaceDir, "devclaw", "log", "audit.log"), "utf8");

      assert.match(audit, /dispatch_delivery_unknown/);
      await assert.rejects(dispatchTask(dispatchInput(h, 62, runCommand)), /active worker/);
      assert.equal(sends, 1);
    } finally {
      await h.cleanup();
    }
  });

  it("reserves one concrete slot for only one of two concurrent issues", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 63, labels: ["To Do"] });
    h.provider.seedIssue({ iid: 64, labels: ["To Do"] });

    try {
      const outcomes = await Promise.allSettled([
        dispatchTask(dispatchInput(h, 63, h.runCommand)),
        dispatchTask(dispatchInput(h, 64, h.runCommand)),
      ]);
      const project = (await h.readProjects()).projects[h.project.slug];
      const winner = getRoleWorker(project, "developer").levels.medior?.[0]?.issueId;

      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.ok(winner === 63 || winner === 64);
      assert.equal(h.commands.taskMessages().length, 1);
    } finally {
      await h.cleanup();
    }
  });

  it("returns a pending result without releasing an in-flight agent turn", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 65, labels: ["To Do"] });
    const pending = new Promise<Awaited<ReturnType<RunCommand>>>(() => { /* gateway turn remains in flight */ });
    const runCommand: RunCommand = async (argv, options) => argv[3] === "agent"
      ? pending : h.runCommand(argv, options);

    try {
      const result = await dispatchTask(dispatchInput(h, 65, runCommand));
      const project = (await h.readProjects()).projects[h.project.slug];

      assert.equal(result.deliveryStatus, "pending");
      assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.issueId, 65);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["65"].activeWorker?.sessionKey, result.sessionKey);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["65"].activeWorker?.delivery?.status, WORKER_DELIVERY_STATUS.PENDING);

      await updateSlot(h.workspaceDir, h.project.slug, "developer", "medior", 0, (slot) => ({
        ...slot,
        delivery: slot.delivery ? { ...slot.delivery, recordedAt: "2026-01-01T00:00:00.000Z" } : undefined,
      }));
      await checkWorkerHealth({
        workspaceDir: h.workspaceDir, projectSlug: h.project.slug,
        project: (await h.readProjects()).projects[h.project.slug],
        role: "developer", autoFix: true, provider: h.provider,
        sessions: new Map([[result.sessionKey, {
          key: result.sessionKey, updatedAt: Date.now(), percentUsed: 1, contextTokens: 2_000,
        }]]),
        workflow: h.workflow, runCommand,
      });
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["65"].activeWorker?.delivery?.status, WORKER_DELIVERY_STATUS.PENDING);
    } finally {
      await h.cleanup();
    }
  });

  it("keeps an unresolved slot and escalates it for manual investigation", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 67, labels: ["To Do"] });
    const runCommand: RunCommand = async (argv, options) => argv[3] === "agent"
      ? { stdout: "", stderr: "response lost", code: 1, signal: null, killed: false, termination: "exit" }
      : h.runCommand(argv, options);

    try {
      const result = await dispatchTask(dispatchInput(h, 67, runCommand));
      const old = "2026-01-01T00:00:00.000Z";

      await updateSlot(h.workspaceDir, h.project.slug, "developer", "medior", 0, (slot) => ({
        ...slot, startTime: old,
        delivery: slot.delivery ? { ...slot.delivery, recordedAt: old } : undefined,
      }));
      await updateIssueRuntimeRecord(h.workspaceDir, h.project.slug, 67, (state) => {
        if (!state?.activeWorker?.delivery) throw new Error("Missing delivery marker");

        return {
          ...state,
          activeWorker: {
            ...state.activeWorker,
            delivery: { ...state.activeWorker.delivery, recordedAt: old },
          },
        };
      });

      await checkWorkerHealth({
        workspaceDir: h.workspaceDir, projectSlug: h.project.slug,
        project: (await h.readProjects()).projects[h.project.slug],
        role: "developer", autoFix: false, provider: h.provider,
        sessions: new Map(), workflow: h.workflow, runCommand,
      });
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["67"].activeWorker?.delivery?.status, WORKER_DELIVERY_STATUS.UNKNOWN);

      const fixes = await checkWorkerHealth({
        workspaceDir: h.workspaceDir, projectSlug: h.project.slug,
        project: (await h.readProjects()).projects[h.project.slug],
        role: "developer", autoFix: true, provider: h.provider,
        sessions: new Map(), workflow: h.workflow, runCommand,
        staleWorkerHours: 0,
      });
      const project = (await h.readProjects()).projects[h.project.slug];
      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["67"];
      const summary = summarizeTaskIssue(await h.provider.getIssue(67), {
        states: { "67": state }, workflow: h.workflow, roles: ["developer"],
      });

      assert.equal(fixes.find((fix) => fix.issue.type === "delivery_unknown")?.fixed, false);
      assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.issueId, 67);
      assert.equal(state.activeWorker?.delivery?.status, WORKER_DELIVERY_STATUS.NEEDS_ATTENTION);
      assert.equal(summary.projection.workerDelivery?.status, WORKER_DELIVERY_STATUS.NEEDS_ATTENTION);
      assert.match(summary.projection.deliveryHint ?? "", /Inspect OpenClaw session/);
      assert.ok((await h.provider.getIssue(67)).labels.includes("Doing"));
      const audit = await fs.readFile(path.join(h.workspaceDir, "devclaw", "log", "audit.log"), "utf8");

      assert.match(audit, /dispatch_delivery_needs_attention/);
      await assert.rejects(dispatchTask(dispatchInput(h, 67, runCommand)), /active worker/);
      assert.equal(result.deliveryStatus, "unknown");
    } finally {
      await h.cleanup();
    }
  });

  it("clears an in-flight delivery marker after explicit gateway acceptance", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 68, labels: ["To Do"] });
    let accept: ((value: Awaited<ReturnType<RunCommand>>) => void) | undefined;
    const pending = new Promise<Awaited<ReturnType<RunCommand>>>((resolve) => { accept = resolve; });
    const runCommand: RunCommand = async (argv, options) => argv[3] === "agent" ? pending : h.runCommand(argv, options);

    try {
      const result = await dispatchTask(dispatchInput(h, 68, runCommand));

      assert.equal(result.deliveryStatus, "pending");
      accept?.({ stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: "exit" });
      for (let attempt = 0; attempt < 30; attempt++) {
        const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["68"];

        if (!state.activeWorker?.delivery) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const project = (await h.readProjects()).projects[h.project.slug];
      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["68"];

      assert.equal(state.activeWorker?.delivery, undefined);
      assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.delivery, undefined);
    } finally {
      await h.cleanup();
    }
  });

  it("reconciles unresolved slots for a role without workflow states", async () => {
    const h = await createTestHarness();
    const old = "2026-01-01T00:00:00.000Z";

    try {
      await updateSlot(h.workspaceDir, h.project.slug, "architect", "senior", 0, (slot) => ({
        ...slot, active: true, issueId: 69, sessionKey: "architect-session", startTime: old,
        delivery: { status: WORKER_DELIVERY_STATUS.SUBMITTING, recordedAt: old, reason: "Gateway response missing" },
      }));
      const fixes = await checkWorkerHealth({
        workspaceDir: h.workspaceDir, projectSlug: h.project.slug,
        project: (await h.readProjects()).projects[h.project.slug],
        role: "architect", autoFix: true, provider: h.provider,
        sessions: null, workflow: h.workflow, runCommand: h.runCommand,
      });
      const project = (await h.readProjects()).projects[h.project.slug];

      assert.equal(fixes[0]?.issue.type, "delivery_unknown");
      assert.equal(fixes[0]?.fixed, false);
      assert.equal(getRoleWorker(project, "architect").levels.senior?.[0]?.delivery?.status, WORKER_DELIVERY_STATUS.NEEDS_ATTENTION);
    } finally {
      await h.cleanup();
    }
  });

  it("records a late ambiguous command failure after an initially pending send", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 70, labels: ["To Do"] });
    let settle: ((value: Awaited<ReturnType<RunCommand>>) => void) | undefined;
    const pending = new Promise<Awaited<ReturnType<RunCommand>>>((resolve) => { settle = resolve; });
    const runCommand: RunCommand = async (argv, options) => argv[3] === "agent" ? pending : h.runCommand(argv, options);

    try {
      const result = await dispatchTask(dispatchInput(h, 70, runCommand));

      assert.equal(result.deliveryStatus, "pending");
      settle?.({ stdout: "", stderr: "connection closed", code: 1, signal: null, killed: false, termination: "exit" });
      for (let attempt = 0; attempt < 30; attempt++) {
        const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["70"];

        if (state.activeWorker?.delivery?.status === WORKER_DELIVERY_STATUS.UNKNOWN) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["70"];

      assert.equal(state.activeWorker?.delivery?.status, WORKER_DELIVERY_STATUS.UNKNOWN);
      assert.match(state.activeWorker.delivery.reason, /connection closed/);
      assert.equal(getRoleWorker((await h.readProjects()).projects[h.project.slug], "developer").levels.medior?.[0]?.active, true);
    } finally {
      await h.cleanup();
    }
  });

  it("requires exact session ownership and preserves the slot on a recovery preview", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 71, labels: ["To Do"] });
    const runCommand: RunCommand = async (argv, options) => argv[3] === "agent"
      ? { stdout: "", stderr: "lost", code: 1, signal: null, killed: false, termination: "exit" }
      : h.runCommand(argv, options);

    try {
      const dispatched = await dispatchTask(dispatchInput(h, 71, runCommand));
      const input = {
        workspaceDir: h.workspaceDir, projectSlug: h.project.slug, issueId: 71,
        sessionKey: dispatched.sessionKey, decision: WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED,
        reason: "Operator verified no run for this issue", apply: false,
        workflow: h.workflow, provider: h.provider,
      };

      await assert.rejects(resolveWorkerDelivery({ ...input, sessionKey: "wrong", apply: true }), /does not own session/);
      const preview = await resolveWorkerDelivery(input);

      assert.equal(preview.applied, false);
      assert.equal(preview.toLabel, "To Do");
      assert.equal(getRoleWorker((await h.readProjects()).projects[h.project.slug], "developer").levels.medior?.[0]?.active, true);
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["71"].activeWorker?.delivery?.status, WORKER_DELIVERY_STATUS.UNKNOWN);
    } finally {
      await h.cleanup();
    }
  });

  it("clears uncertainty after an operator confirms the worker started", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 72, labels: ["To Do"] });
    const runCommand: RunCommand = async (argv, options) => argv[3] === "agent"
      ? { stdout: "", stderr: "lost", code: 1, signal: null, killed: false, termination: "exit" }
      : h.runCommand(argv, options);

    try {
      const dispatched = await dispatchTask(dispatchInput(h, 72, runCommand));
      const input = {
        workspaceDir: h.workspaceDir, projectSlug: h.project.slug, issueId: 72,
        sessionKey: dispatched.sessionKey, reason: "Operator checked the gateway run", apply: true,
        workflow: h.workflow, provider: h.provider,
      };

      await resolveWorkerDelivery({ ...input, decision: WORKER_DELIVERY_RESOLUTION.CONFIRMED_STARTED });
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["72"].activeWorker?.delivery, undefined);
      assert.equal(getRoleWorker((await h.readProjects()).projects[h.project.slug], "developer").levels.medior?.[0]?.delivery, undefined);
      await assert.rejects(resolveWorkerDelivery({ ...input, decision: WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED }), /no unresolved worker delivery/);
    } finally {
      await h.cleanup();
    }
  });

  it("returns a verified non-start to the queue and releases its exact slot", async () => {
    const h = await createTestHarness();
    h.provider.seedIssue({ iid: 73, labels: ["To Do"] });
    const runCommand: RunCommand = async (argv, options) => argv[3] === "agent"
      ? { stdout: "", stderr: "lost", code: 1, signal: null, killed: false, termination: "exit" }
      : h.runCommand(argv, options);

    try {
      const dispatched = await dispatchTask(dispatchInput(h, 73, runCommand));

      await resolveWorkerDelivery({
        workspaceDir: h.workspaceDir, projectSlug: h.project.slug, issueId: 73,
        sessionKey: dispatched.sessionKey, reason: "Operator verified no run for this issue", apply: true,
        workflow: h.workflow, provider: h.provider,
        decision: WORKER_DELIVERY_RESOLUTION.CONFIRMED_NOT_STARTED,
      });
      const state = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["73"];

      assert.equal(state.activeWorker, null);
      assert.equal(state.workflowLabel, "To Do");
      assert.ok((await h.provider.getIssue(73)).labels.includes("To Do"));
      assert.equal(getRoleWorker((await h.readProjects()).projects[h.project.slug], "developer").levels.medior?.[0]?.active, false);
    } finally {
      await h.cleanup();
    }
  });
});
