import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  DEFAULT_WORKFLOW,
  DEFAULT_RESULT_EMOJI,
  getCompletionEmoji,
  getLabelColors,
  getOwnerLabel,
  getRoleLabels,
  ISSUE_PROVIDER,
  STATE_TYPE,
  type WorkflowConfig,
  WORKFLOW_EVENT,
} from "../../domain/index.js";
import { loadConfig } from "../../state/config/index.js";
import { readIssueStateStore, writeIssueRuntimeState } from "../../state/issues/index.js";
import { getProject, getRoleWorker, readProjects } from "../../state/projects/index.js";
import { createTestHarness, type TestHarness } from "../../testing/index.js";
import { projectTick } from "../queue/tick.js";
import { executeCompletion } from "./completion.js";

const CUSTOM_ROLE = "security_auditor";
const CUSTOM_QUEUE = "securityQueue";
const CUSTOM_ACTIVE = "securityActive";
const CUSTOM_QUEUE_LABEL = "Security Queue";
const CUSTOM_ACTIVE_LABEL = "Security Active";
const CUSTOM_LEVEL = "principal";

const customWorkflow: WorkflowConfig = {
  ...DEFAULT_WORKFLOW,
  initial: CUSTOM_QUEUE,
  states: {
    ...DEFAULT_WORKFLOW.states,
    [CUSTOM_QUEUE]: {
      type: STATE_TYPE.QUEUE,
      role: CUSTOM_ROLE,
      label: CUSTOM_QUEUE_LABEL,
      color: "#123456",
      on: {
        [WORKFLOW_EVENT.PICKUP]: { target: CUSTOM_ACTIVE },
      },
    },
    [CUSTOM_ACTIVE]: {
      type: STATE_TYPE.ACTIVE,
      role: CUSTOM_ROLE,
      label: CUSTOM_ACTIVE_LABEL,
      color: "#654321",
      on: {
        [WORKFLOW_EVENT.COMPLETE]: { target: "done", actions: ["closeIssue"] },
        [WORKFLOW_EVENT.BLOCKED]: { target: "refining" },
      },
    },
  },
};

describe("custom configuration E2E", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
  });

  it("runs a custom role and level from queue pickup through persisted completion", async () => {
    harness = await createTestHarness({
      workflow: customWorkflow,
      workers: {
        [CUSTOM_ROLE]: { level: CUSTOM_LEVEL },
      },
    });

    await fs.writeFile(path.join(harness.workspaceDir, "devclaw", "workflow.yaml"), `
roles:
  security_auditor:
    levels: [apprentice, principal]
    defaultLevel: apprentice
    models:
      apprentice: model/security-fast
      principal: model/security-deep
    completion:
      audited: COMPLETE
      blocked: BLOCKED
workflow:
  initial: securityQueue
  states:
    securityQueue:
      type: queue
      role: security_auditor
      label: Security Queue
      color: "#123456"
      on:
        PICKUP:
          target: securityActive
    securityActive:
      type: active
      role: security_auditor
      label: Security Active
      color: "#654321"
      on:
        COMPLETE:
          target: done
          actions: [closeIssue]
        BLOCKED:
          target: refining
`, "utf8");
    await harness.writePrompt(CUSTOM_ROLE, "Perform a complete security audit.");

    const resolvedConfig = await loadConfig(harness.workspaceDir, harness.project.name);
    const roleLabels = getRoleLabels(resolvedConfig.roles);

    assert.equal(roleLabels.some((label) => label.name === `${CUSTOM_ROLE}:apprentice`), true);
    assert.equal(roleLabels.some((label) => label.name === `${CUSTOM_ROLE}:${CUSTOM_LEVEL}`), true);
    assert.equal(getCompletionEmoji("audited"), DEFAULT_RESULT_EMOJI);

    await harness.provider.ensureAllStateLabels();
    assert.equal(harness.provider.labels.has(CUSTOM_QUEUE_LABEL), true);
    assert.equal(harness.provider.labels.has(CUSTOM_ACTIVE_LABEL), true);
    assert.equal(getLabelColors(customWorkflow).get(CUSTOM_QUEUE_LABEL), "#123456");

    const issue = harness.provider.seedIssue({
      iid: 501,
      title: "Audit authentication",
      labels: [CUSTOM_QUEUE_LABEL, `${CUSTOM_ROLE}:${CUSTOM_LEVEL}`, getOwnerLabel("primary")],
    });
    await writeIssueRuntimeState({
      workspaceDir: harness.workspaceDir,
      project: harness.project,
      issue,
      providerType: ISSUE_PROVIDER.GITHUB,
      workflow: customWorkflow,
      workflowState: CUSTOM_QUEUE,
      workflowLabel: CUSTOM_QUEUE_LABEL,
      assignedRole: CUSTOM_ROLE,
      assignedLevel: CUSTOM_LEVEL,
      owner: "primary",
    });

    const tick = await projectTick({
      workspaceDir: harness.workspaceDir,
      projectSlug: harness.project.slug,
      targetRole: CUSTOM_ROLE,
      provider: harness.provider,
      workflow: customWorkflow,
      instanceName: "primary",
      runCommand: harness.runCommand,
    });

    assert.equal(tick.pickups.length, 1);
    assert.equal(tick.pickups[0]?.role, CUSTOM_ROLE);
    assert.equal(tick.pickups[0]?.level, CUSTOM_LEVEL);
    assert.match(harness.commands.extraSystemPrompts()[0] ?? "", /complete security audit/);

    const activeProjects = await readProjects(harness.workspaceDir);
    const activeProject = getProject(activeProjects, harness.project.slug);
    assert.ok(activeProject);
    assert.equal(getRoleWorker(activeProject, CUSTOM_ROLE).levels[CUSTOM_LEVEL]?.[0]?.active, true);

    const completionInput = {
      workspaceDir: harness.workspaceDir,
      projectSlug: harness.project.slug,
      role: CUSTOM_ROLE,
      result: "audited",
      issueId: issue.iid,
      summary: "Authentication audit passed",
      provider: harness.provider,
      repoPath: harness.project.repo,
      projectName: harness.project.name,
      channels: harness.project.channels,
      workflow: customWorkflow,
      level: CUSTOM_LEVEL,
      slotIndex: 0,
      runCommand: harness.runCommand,
    };

    await assert.rejects(
      executeCompletion({ ...completionInput, result: "unmapped" }),
      /No completion event configured/,
    );
    await executeCompletion({ ...completionInput, result: "audited" });

    const completedProjects = await readProjects(harness.workspaceDir);
    const completedProject = getProject(completedProjects, harness.project.slug);
    assert.ok(completedProject);
    assert.equal(getRoleWorker(completedProject, CUSTOM_ROLE).levels[CUSTOM_LEVEL]?.[0]?.active, false);

    const completedIssue = await harness.provider.getIssue(issue.iid);
    assert.equal(completedIssue.labels.includes("Done"), true);

    const reloadedStore = await readIssueStateStore(harness.workspaceDir, harness.project.slug);
    assert.equal(reloadedStore.issues[String(issue.iid)]?.workflowState, "done");
    assert.equal(reloadedStore.issues[String(issue.iid)]?.assignedRole, CUSTOM_ROLE);
    assert.equal(reloadedStore.issues[String(issue.iid)]?.assignedLevel, CUSTOM_LEVEL);
  });
});
