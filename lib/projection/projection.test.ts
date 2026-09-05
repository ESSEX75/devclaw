import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  NOTIFICATION_CHANNEL,
  type IssueRuntimeState,
} from "../domain/index.js";
import {
  diffIssueProjection,
  expectedManagedLabels,
  extractIssueMetadata,
  metadataMatches,
  renderIssueMetadata,
  replaceIssueMetadata,
} from "./index.js";

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
    notifyTarget: { channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "primary" },
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

describe("projection labels", () => {
  it("derives expected managed labels from issue state", () => {
    assert.deepStrictEqual(expectedManagedLabels(state()), [
      "To Do",
      "developer:medior",
      "notify:telegram:primary",
      "owner:main",
      "review:human",
      "test:skip",
    ]);
  });

  it("diffs missing and unexpected managed labels while preserving human labels", () => {
    const diff = diffIssueProjection({
      state: state(),
      actualLabels: ["Doing", "bug", "developer:senior", "owner:main", "priority:high"],
      options: { stateLabels: ["To Do", "Doing"], roles: ["developer"] },
    });

    assert.deepStrictEqual(diff.unmanagedLabels, ["bug", "priority:high"]);
    assert.ok(diff.missingManagedLabels.includes("To Do"));
    assert.ok(diff.missingManagedLabels.includes("developer:medior"));
    assert.ok(diff.unexpectedManagedLabels.includes("Doing"));
    assert.ok(diff.unexpectedManagedLabels.includes("developer:senior"));
  });
});

describe("projection metadata", () => {
  it("renders and extracts compact issue metadata", () => {
    const metadata = { projectSlug: "devclaw", issueId: 123, projectionVersion: 1 };
    const rendered = renderIssueMetadata(metadata);

    assert.strictEqual(rendered, '<!-- devclaw:issue-metadata {"projectSlug":"devclaw","issueId":123,"projectionVersion":1} -->');
    assert.deepStrictEqual(extractIssueMetadata(rendered), metadata);
  });

  it("replaces existing metadata and appends missing metadata", () => {
    const metadata = { projectSlug: "devclaw", issueId: 123, projectionVersion: 1 };
    assert.strictEqual(replaceIssueMetadata("Body", metadata), `Body\n\n${renderIssueMetadata(metadata)}`);
    assert.strictEqual(
      replaceIssueMetadata(`Body\n\n${renderIssueMetadata({ projectSlug: "x", issueId: 1, projectionVersion: 1 })}`, metadata),
      `Body\n\n${renderIssueMetadata(metadata)}`,
    );
  });

  it("detects metadata mismatch without requiring a full state hash", () => {
    const expected = { projectSlug: "devclaw", issueId: 123, projectionVersion: 1 };
    assert.strictEqual(metadataMatches(expected, expected), true);
    assert.strictEqual(metadataMatches({ ...expected, issueId: 999 }, expected), false);
  });
});

