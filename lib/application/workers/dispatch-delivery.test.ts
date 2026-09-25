/** Tests worker reservation safety across gateway rejection, uncertainty, and contention. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import type { RunCommand } from "../../context.js";
import { getRoleWorker } from "../../state/index.js";
import { readIssueStateStore } from "../../state/index.js";
import { createTestHarness } from "../../testing/index.js";
import { dispatchTask } from "./dispatch-task.js";

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
      assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["66"].activeWorker?.sessionKey, result.sessionKey);
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
    } finally {
      await h.cleanup();
    }
  });
});
