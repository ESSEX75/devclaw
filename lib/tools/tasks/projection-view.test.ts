import { describe, it } from "node:test";
import assert from "node:assert";
import { DEFAULT_WORKFLOW, ISSUE_INTEGRITY_STATUS, ISSUE_PROVIDER, type IssueRuntimeState } from "../../domain/index.js";
import { summarizeTaskIssue, type ProjectionViewContext } from "../../application/tasks/index.js";

function state(overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
  return {
    projectSlug: "devclaw",
    issueId: 123,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "todo",
    workflowLabel: "To Do",
    assignedRole: "developer",
    assignedLevel: "medior",
    owner: "main",
    reviewPolicy: "human",
    testPolicy: "skip",
    notifyTarget: null,
    branchContract: null,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

function ctx(issueState?: IssueRuntimeState): ProjectionViewContext {
  return {
    states: issueState ? { [String(issueState.issueId)]: issueState } : {},
    workflow: DEFAULT_WORKFLOW,
    roles: ["developer"],
  };
}

describe("task projection view", () => {
  it("shows local state, provider labels, and projection drift", () => {
    const summary = summarizeTaskIssue({
      iid: 123,
      title: "Implement feature",
      description: "Body",
      labels: ["Doing", "bug", "review:human", "test:skip", "owner:main"],
      state: "opened",
      web_url: "https://example.com/issues/123",
    }, ctx(state()));

    assert.strictEqual(summary.projection.localState?.workflowState, "todo");
    assert.strictEqual(summary.projection.localState?.workflowLabel, "To Do");
    assert.strictEqual(summary.projection.integrityStatus, ISSUE_INTEGRITY_STATUS.OK);
    assert.ok(summary.projection.providerLabels.includes("bug"));
    assert.ok(summary.projection.missingManagedLabels.includes("To Do"));
    assert.ok(summary.projection.unexpectedManagedLabels.includes("Doing"));
    assert.ok(summary.projection.unmanagedLabels.includes("bug"));
    assert.ok(summary.projection.repairHint?.includes("--source local-state --dry-run"));
  });

  it("marks old issues without local state as projection_uninitialized", () => {
    const summary = summarizeTaskIssue({
      iid: 456,
      title: "Legacy issue",
      description: "Body",
      labels: ["To Do", "human"],
      state: "opened",
      web_url: "https://example.com/issues/456",
    }, ctx());

    assert.strictEqual(summary.projection.localState, null);
    assert.strictEqual(
      summary.projection.integrityStatus,
      ISSUE_INTEGRITY_STATUS.PROJECTION_UNINITIALIZED,
    );
    assert.deepStrictEqual(summary.projection.unmanagedLabels, ["To Do", "human"]);
    assert.strictEqual(summary.projection.repairHint, null);
  });

  it("shows integrity_error and repair hint", () => {
    const summary = summarizeTaskIssue({
      iid: 123,
      title: "Tampered issue",
      description: "Body",
      labels: ["To Do", "developer:medior", "owner:main", "review:human", "test:skip"],
      state: "opened",
      web_url: "https://example.com/issues/123",
    }, ctx(state({ integrityStatus: ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, integrityErrors: ["metadata tamper"] })));

    assert.strictEqual(summary.projection.integrityStatus, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR);
    assert.ok(summary.projection.repairHint?.includes("issue_repair 123"));
  });
});
