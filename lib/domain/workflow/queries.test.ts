import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ROLES,
  DEFAULT_WORKFLOW,
  detectRoleFromLabel,
  findStateKeyByLabel,
  getActiveLabel,
  getCompletionRule,
  getRevertLabel,
  STATE_TYPE,
  WORKFLOW_EVENT,
  WORKFLOW_STATE_COLORS,
  WORKFLOW_STATE_KEYS,
  WORKFLOW_STATE_LABELS,
  type RoleDefinition,
  type RoleId,
  type WorkflowConfig,
  type WorkflowLabel,
  type WorkflowStateKey,
} from "../index.js";

describe("getRevertLabel", () => {
  it("matches an object-form PICKUP transition target", () => {
    const workflow: WorkflowConfig = {
      ...DEFAULT_WORKFLOW,
      states: {
        ...DEFAULT_WORKFLOW.states,
        [WORKFLOW_STATE_KEYS.TODO]: {
          type: STATE_TYPE.QUEUE,
          role: DEFAULT_ROLES.DEVELOPER,
          label: WORKFLOW_STATE_LABELS.TODO,
          color: WORKFLOW_STATE_COLORS.TODO,
          priority: 10,
          on: {
            [WORKFLOW_EVENT.PICKUP]: {
              target: WORKFLOW_STATE_KEYS.RESEARCHING,
            },
          },
        },
        [WORKFLOW_STATE_KEYS.TO_IMPROVE]: {
          type: STATE_TYPE.QUEUE,
          role: DEFAULT_ROLES.DEVELOPER,
          label: WORKFLOW_STATE_LABELS.TO_IMPROVE,
          color: WORKFLOW_STATE_COLORS.TO_IMPROVE,
          priority: 1,
          on: {
            [WORKFLOW_EVENT.PICKUP]: {
              target: WORKFLOW_STATE_KEYS.DOING,
            },
          },
        },
      },
    };

    assert.equal(
      getRevertLabel(workflow, DEFAULT_ROLES.DEVELOPER),
      WORKFLOW_STATE_LABELS.TO_IMPROVE,
    );
  });
});

describe("extensible workflow queries", () => {
  it("preserves custom role, state key, label, and level types", () => {
    type CustomRoleId = RoleId | "security_auditor";
    type CustomStateKey = WorkflowStateKey | "securityReview" | "securityReviewing";
    type CustomLabel = WorkflowLabel | "Security Review" | "Security Reviewing";
    type CustomLevelId = "standard" | "expert";

    const customRole: RoleDefinition<CustomLevelId> = {
      levels: ["standard", "expert"],
      enabled: true,
    };
    const workflow: WorkflowConfig<CustomRoleId, CustomStateKey, CustomLabel> = {
      ...DEFAULT_WORKFLOW,
      states: {
        ...DEFAULT_WORKFLOW.states,
        securityReview: {
          type: STATE_TYPE.QUEUE,
          role: "security_auditor",
          label: "Security Review",
          color: "#123456",
          on: {
            [WORKFLOW_EVENT.PICKUP]: {
              target: "securityReviewing",
            },
          },
        },
        securityReviewing: {
          type: STATE_TYPE.ACTIVE,
          role: "security_auditor",
          label: "Security Reviewing",
          color: "#654321",
          on: {
            [WORKFLOW_EVENT.COMPLETE]: {
              target: WORKFLOW_STATE_KEYS.DONE,
            },
          },
        },
      },
    };
    const stateKey: CustomStateKey | null = findStateKeyByLabel(workflow, "Security Review");
    const role: CustomRoleId | null = detectRoleFromLabel(workflow, "Security Review");
    const activeLabel: CustomLabel = getActiveLabel(workflow, "security_auditor");
    const completionRule = getCompletionRule(
      workflow,
      "security_auditor",
      WORKFLOW_EVENT.COMPLETE,
    );

    assert.deepEqual(customRole.levels, ["standard", "expert"]);
    assert.equal(stateKey, "securityReview");
    assert.equal(role, "security_auditor");
    assert.equal(activeLabel, "Security Reviewing");
    assert.equal(completionRule?.from, "Security Reviewing");
    assert.equal(completionRule?.to, WORKFLOW_STATE_LABELS.DONE);
  });
});
