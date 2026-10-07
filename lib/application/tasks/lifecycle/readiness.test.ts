/** Ensures prepared runtime records remain unavailable until their creation operation is ready. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { DEFAULT_WORKFLOW, ISSUE_CREATION_STATUS, ISSUE_PROVIDER } from "../../../domain/index.js";
import { GitHubProvider } from "../../../integrations/providers/github/index.js";
import { readIssueStateStore, updateIssueCreationStore } from "../../../state/index.js";
import { createTestHarness } from "../../../testing/index.js";
import { createManagedTaskIssue } from "../creation/index.js";
import { claimManagedTask } from "./claim-task.js";
import { setTaskLevel } from "./set-task-level.js";
import { startTask } from "./start-task.js";

it("refuses claim, approval, and prepared-level changes before creation readiness", async t => {
  const harness = await createTestHarness();
  t.after(() => harness.cleanup());
  const created = await createManagedTaskIssue({
    workspaceDir: harness.workspaceDir, project: harness.project,
    providerType: ISSUE_PROVIDER.GITHUB, provider: harness.provider, workflow: DEFAULT_WORKFLOW,
    title: "Creation readiness", description: "Await durable readiness", idempotencyKey: "readiness", requestedBy: "test"
  });
  assert.equal(created.success, true);
  assert.ok(created.issue);
  await updateIssueCreationStore(harness.workspaceDir, harness.project.slug, store => ({
    store: {
      ...store, operations: {
        ...store.operations, readiness: {
          ...store.operations.readiness!, status: ISSUE_CREATION_STATUS.PROJECTION_VERIFIED,
        }
      }
    }, result: undefined,
  }));
  const before = await readIssueStateStore(harness.workspaceDir, harness.project.slug);
  t.mock.method(GitHubProvider.prototype, "getIssue", (id: number) => harness.provider.getIssue(id));
  const effects = t.mock.method(GitHubProvider.prototype, "editIssue", () => { throw new Error("Unexpected mutation"); });
  const input = {
    workspaceDir: harness.workspaceDir, channelId: harness.project.channels[0]!.channelId,
    issueId: created.issue.iid, runCommand: harness.runCommand
  };
  await assert.rejects(setTaskLevel({ ...input, level: "senior" }), /creation is not ready/);
  await assert.rejects(startTask(input), /creation is not ready/);
  assert.deepEqual(await claimManagedTask({
    workspaceDir: harness.workspaceDir, project: harness.project,
    issueId: created.issue.iid, instanceName: "new-owner", force: true, provider: harness.provider,
    providerType: ISSUE_PROVIDER.GITHUB, workflow: DEFAULT_WORKFLOW, roles: ["developer"]
  }),
    { claimed: false, reason: "Issue creation is not ready" });
  assert.deepEqual(await readIssueStateStore(harness.workspaceDir, harness.project.slug), before);
  assert.equal(effects.mock.callCount(), 0);
});

it("transfers an initialized issue using local state even when the provider issue is closed", async t => {
  const harness = await createTestHarness();
  t.after(() => harness.cleanup());
  const created = await createManagedTaskIssue({
    workspaceDir: harness.workspaceDir, project: harness.project,
    providerType: ISSUE_PROVIDER.GITHUB, provider: harness.provider, workflow: DEFAULT_WORKFLOW,
    title: "Transfer owner", description: "Use local ownership", idempotencyKey: "claim-closed", requestedBy: "test",
  });

  assert.ok(created.issue);
  await harness.provider.closeIssue(created.issue.iid);
  const result = await claimManagedTask({
    workspaceDir: harness.workspaceDir, project: harness.project,
    issueId: created.issue.iid, instanceName: "new-owner", force: true, provider: harness.provider,
    providerType: ISSUE_PROVIDER.GITHUB, workflow: DEFAULT_WORKFLOW, roles: ["developer"],
  });

  assert.deepEqual(result, { claimed: true });
  assert.equal((await readIssueStateStore(harness.workspaceDir, harness.project.slug)).issues[String(created.issue.iid)].owner, "new-owner");
});
