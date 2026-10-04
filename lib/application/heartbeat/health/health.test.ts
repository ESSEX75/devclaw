/** Verifies that worker health diagnosis supports roles from the resolved workflow. */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { STATE_TYPE, type WorkflowConfig, WORKFLOW_EVENT } from "../../../domain/index.js";
import { createTestHarness, type TestHarness } from "../../../testing/index.js";
import { writeIssueRuntimeState } from "../../issue-runtime/index.js";
import { checkWorkerHealth } from "./index.js";

/** Custom role used to exercise workflow-driven health diagnosis. */
const DESIGNER_WORKFLOW: WorkflowConfig = {
  initial: "toDesign",
  states: {
    toDesign: {
      type: STATE_TYPE.QUEUE,
      role: "designer",
      label: "To Design",
      color: "#123456",
      on: { [WORKFLOW_EVENT.PICKUP]: { target: "designing" } },
    },
    designing: {
      type: STATE_TYPE.ACTIVE,
      role: "designer",
      label: "Designing",
      color: "#654321",
      on: { [WORKFLOW_EVENT.COMPLETE]: { target: "toDesign" } },
    },
  },
};

describe("custom-role health checks", () => {
  let harness: TestHarness;

  afterEach(async () => {
    if (harness) await harness.cleanup();
  });

  it("checks worker slots belonging to a configured custom role", async () => {
    harness = await createTestHarness({
      workflow: DESIGNER_WORKFLOW,
      workers: {
        designer: {
          level: "standard",
          active: true,
          issueId: 42,
          sessionKey: null,
          startTime: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    const issue = harness.provider.seedIssue({ iid: 42, title: "Design", labels: ["Designing"] });
    await writeIssueRuntimeState({
      workspaceDir: harness.workspaceDir, project: harness.project, issue,
      providerType: harness.project.provider, workflow: DESIGNER_WORKFLOW,
      workflowState: "designing", workflowLabel: "Designing",
      activeWorker: { role: "designer", level: "standard", slotIndex: 0, sessionKey: "designer-session", startedAt: "2026-01-01T00:00:00.000Z" },
    });

    const fixes = await checkWorkerHealth({
      workspaceDir: harness.workspaceDir,
      projectSlug: harness.project.slug,
      project: harness.project,
      role: "designer",
      autoFix: false,
      provider: harness.provider,
      sessions: null,
      workflow: DESIGNER_WORKFLOW,
      runCommand: harness.runCommand,
    });

    assert.equal(fixes.length, 1);
    assert.equal(fixes[0]?.issue.type, "session_dead");
    assert.equal(fixes[0]?.issue.level, "standard");
  });

  it("does not treat a provider label as runtime state when a slot has no local issue", async () => {
    harness = await createTestHarness({
      workflow: DESIGNER_WORKFLOW,
      workers: { designer: { level: "standard", active: true, issueId: 42, sessionKey: null } },
    });
    harness.provider.seedIssue({ iid: 42, title: "Design", labels: ["Designing"] });

    const findings = await checkWorkerHealth({
      workspaceDir: harness.workspaceDir,
      projectSlug: harness.project.slug,
      project: harness.project,
      role: "designer",
      autoFix: true,
      provider: harness.provider,
      sessions: null,
      workflow: DESIGNER_WORKFLOW,
      runCommand: harness.runCommand,
    });

    assert.equal(findings[0]?.issue.type, "issue_state_missing");
    assert.equal(findings[0]?.plannedAction, undefined);
    assert.equal(findings[0]?.fixed, false);
    assert.equal(harness.provider.callsTo("transitionLabel").length, 0);
  });
});
