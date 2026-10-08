/** Verifies that task edits preserve managed metadata and recheck state after acquiring the issue lock. */
import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { DEFAULT_WORKFLOW, ISSUE_PROVIDER } from "../../../domain/index.js";
import { GitHubProvider } from "../../../integrations/index.js";
import { extractIssueMetadata, renderIssueCreationMarker, replaceIssueMetadata } from "../../../projection/index.js";
import { withIssueOrchestrationLock } from "../../../state/index.js";
import { createTestHarness } from "../../../testing/index.js";
import { writeIssueRuntimeState } from "../../issue-runtime/index.js";
import { editTaskBody } from "./edit-task-body.js";

it("preserves metadata and creation marker on body/title edits and repeated requests", async () => {
  const harness = await createTestHarness();
  try {
    const marker = renderIssueCreationMarker("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const issue = await harness.provider.createIssue({
      title: "Before", body: replaceIssueMetadata(`Before body\n${marker}`, {
        projectSlug: harness.project.slug, issueId: 1,
      }), labels: ["Planning"], assignees: []
    });
    await writeIssueRuntimeState({ workspaceDir: harness.workspaceDir, project: harness.project, issue, providerType: ISSUE_PROVIDER.GITHUB, workflow: DEFAULT_WORKFLOW });
    const get = mock.method(GitHubProvider.prototype, "getIssue", (id: number) => harness.provider.getIssue(id));
    const edit = mock.method(GitHubProvider.prototype, "editIssue", (...args: Parameters<GitHubProvider["editIssue"]>) => harness.provider.editIssue(...args));
    const input = { workspaceDir: harness.workspaceDir, channelId: harness.project.channels[0]!.channelId, issueId: issue.iid, runCommand: harness.runCommand, addComment: false };
    await editTaskBody({ ...input, body: "New user content" });
    const updated = await harness.provider.getIssue(issue.iid);
    assert.equal(extractIssueMetadata(updated.description)?.projectSlug, harness.project.slug);
    assert.ok(updated.description.includes(marker));
    assert.ok(updated.description.includes("New user content"));
    assert.equal((await editTaskBody({ ...input, body: "New user content" })).changed, false);
    await editTaskBody({ ...input, title: "After" });
    assert.equal((await harness.provider.getIssue(issue.iid)).description, updated.description);
    assert.equal(edit.mock.callCount(), 2);
    get.mock.restore(); edit.mock.restore();
  } finally { mock.restoreAll(); await harness.cleanup(); }
});
it("waits for a concurrent transition and rejects editing the newly active state", async () => {
  const harness = await createTestHarness();
  try {
    const issue = await harness.provider.createIssue({ title: "Before", body: "body", labels: ["Planning"], assignees: [] });
    await writeIssueRuntimeState({ workspaceDir: harness.workspaceDir, project: harness.project, issue, providerType: ISSUE_PROVIDER.GITHUB, workflow: DEFAULT_WORKFLOW });
    mock.method(GitHubProvider.prototype, "getIssue", (id: number) => harness.provider.getIssue(id));
    const edit = mock.method(GitHubProvider.prototype, "editIssue", (...args: Parameters<GitHubProvider["editIssue"]>) => harness.provider.editIssue(...args));
    let acquired!: () => void;
    const entered = new Promise<void>(resolve => { acquired = resolve; });
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const transition = withIssueOrchestrationLock(harness.workspaceDir, harness.project.slug, issue.iid, async () => {
      acquired(); await released;
      await writeIssueRuntimeState({
        workspaceDir: harness.workspaceDir, project: harness.project, issue,
        providerType: ISSUE_PROVIDER.GITHUB, workflow: DEFAULT_WORKFLOW, workflowState: "doing"
      });
    });
    await entered;
    const pending = editTaskBody({
      workspaceDir: harness.workspaceDir, channelId: harness.project.channels[0]!.channelId,
      issueId: issue.iid, runCommand: harness.runCommand, body: "should not persist", addComment: false
    });
    const rejection = assert.rejects(pending, /Cannot edit/);
    release(); await transition; await rejection;
    assert.equal(edit.mock.callCount(), 0);
  } finally { mock.restoreAll(); await harness.cleanup(); }
});
