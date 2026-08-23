import assert from "node:assert";
import { describe, it } from "node:test";

import {
  DEFAULT_WORKFLOW,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  type IssueRuntimeState,
} from "../../domain/index.js";
import { ROLE_REGISTRY } from "../../roles/index.js";
import type { ResolvedRoleConfig } from "../../state/config/index.js";
import { resolveRoleLevel, resolveStartTaskDecision } from "./lifecycle-decision.js";

const baseState: IssueRuntimeState = {
  projectSlug: "devclaw",
  issueId: 79,
  provider: ISSUE_PROVIDER.GITHUB,
  workflowState: "planning",
  workflowLabel: "Planning",
  assignedRole: null,
  assignedLevel: null,
  integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
  integrityErrors: [],
  projectionVersion: 1,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

function roleConfig(role: keyof typeof ROLE_REGISTRY): ResolvedRoleConfig {
  const definition = ROLE_REGISTRY[role];

  return {
    levels: [...definition.levels],
    defaultLevel: definition.defaultLevel,
    levelMaxWorkers: {},
    models: {},
    emoji: {},
    completion: definition.completion,
    enabled: true,
  };
}

describe("task lifecycle decisions", () => {
  it("uses an explicit valid level for the target role", () => {
    const decision = resolveStartTaskDecision({
      workflow: DEFAULT_WORKFLOW,
      currentState: DEFAULT_WORKFLOW.states.planning!,
      runtimeState: baseState,
      roles: { developer: roleConfig("developer") },
      requestedLevel: "junior",
      issueTitle: "Build a button",
      issueDescription: "",
    });

    assert.equal(decision.targetStateKey, "todo");
    assert.equal(decision.targetRole, "developer");
    assert.equal(decision.assignedLevel, "junior");
  });

  it("reuses a prepared level only while the assigned role is unchanged", () => {
    const developer = roleConfig("developer");
    const prepared = { ...baseState, assignedRole: "developer", assignedLevel: "senior" };

    assert.equal(resolveRoleLevel({
      runtimeState: prepared,
      targetRole: "developer",
      roleConfig: developer,
      issueTitle: "Small change",
      issueDescription: "",
    }), "senior");
  });

  it("does not inherit a compatible level when the role changes", () => {
    const tester = roleConfig("tester");
    const previousRole = { ...baseState, assignedRole: "developer", assignedLevel: "senior" };

    assert.equal(resolveRoleLevel({
      runtimeState: previousRole,
      targetRole: "tester",
      roleConfig: tester,
      issueTitle: "Small change",
      issueDescription: "",
    }), "junior");
  });

  it("uses the configured default for a custom role", () => {
    const customRole: ResolvedRoleConfig = {
      levels: ["apprentice", "principal"],
      defaultLevel: "apprentice",
      levelMaxWorkers: {},
      models: {},
      emoji: {},
      completion: {},
      enabled: true,
    };

    assert.equal(resolveRoleLevel({
      runtimeState: baseState,
      targetRole: "security_auditor",
      roleConfig: customRole,
      issueTitle: "Review security architecture",
      issueDescription: "",
    }), "apprentice");
  });
});
