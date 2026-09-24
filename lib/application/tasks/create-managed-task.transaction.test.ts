/**
 * Exercises the durable issue-creation saga at its failure and idempotency boundaries.
 * These tests prove that provider-side partial success never becomes runnable local state.
 */
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { DEFAULT_WORKFLOW, ISSUE_CREATION_STATUS, ISSUE_PROVIDER, NOTIFICATION_CHANNEL } from "../../domain/index.js";
import {
  PROVIDER_OPERATION_ERROR,
  ProviderOperationError,
  type CreateIssueInput,
  type Issue,
} from "../../integrations/providers/index.js";
import { readIssueCreationStore, readIssueStateStore, updateIssueCreationStore } from "../../state/index.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { TestProvider } from "../../testing/test-provider.js";
import { findNextIssueForRole } from "../queue/scan.js";
import { createManagedTaskIssue, reconcileManagedTaskCreations } from "./creation/index.js";
import { CREATION_STEPS } from "./creation/const.js";

const project = {
  slug: "devclaw",
  channels: [{
    channelId: "telegram:1",
    channel: NOTIFICATION_CHANNEL.TELEGRAM,
    name: "primary",
    accountId: "default",
  }],
};

function input(workspaceDir: string, provider: TestProvider, idempotencyKey: string) {
  return {
    workspaceDir,
    project,
    providerType: ISSUE_PROVIDER.GITHUB,
    provider,
    workflow: DEFAULT_WORKFLOW,
    roles: ["developer", "architect", "tester", "reviewer"],
    title: "Create transaction",
    description: "Verify the durable saga",
    idempotencyKey,
    requestedBy: "test",
  };
}

async function withWorkspace(run: (workspaceDir: string) => Promise<void>): Promise<void> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-creation-"));

  try {
    await run(workspaceDir);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

class UnknownOutcomeProvider extends TestProvider {
  override async createIssue(createInput: CreateIssueInput): Promise<Issue> {
    await super.createIssue(createInput);
    throw new ProviderOperationError({
      code: PROVIDER_OPERATION_ERROR.TRANSIENT,
      message: "Network timeout after request submission",
      retryable: true,
      outcomeUnknown: true,
    });
  }
}

class ReadBackFailureProvider extends TestProvider {
  failReadBack = true;

  override async getIssue(issueId: number): Promise<Issue> {
    if (this.failReadBack) throw new Error("temporary read-back failure");

    return super.getIssue(issueId);
  }
}

class LimitedProvider extends TestProvider {
  async getRateLimitStatus(): Promise<{ remaining: number; resetAt: string }> {
    return { remaining: 0, resetAt: new Date(Date.now() + 60_000).toISOString() };
  }
}

class KnownFailureProvider extends TestProvider {
  failNextCreate = true;

  override async createIssue(createInput: CreateIssueInput): Promise<Issue> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      this.calls.push({ method: "createIssue", args: createInput });
      throw new ProviderOperationError({
        code: PROVIDER_OPERATION_ERROR.TRANSIENT,
        message: "Provider rejected the first request before creating an issue",
        retryable: true,
        outcomeUnknown: false,
      });
    }

    return super.createIssue(createInput);
  }
}

class ProjectionMismatchProvider extends TestProvider {
  mismatchReadBack = true;

  override async getIssue(issueId: number): Promise<Issue> {
    const issue = await super.getIssue(issueId);

    return this.mismatchReadBack ? { ...issue, title: "Wrong provider title" } : issue;
  }
}

class LocalCommitReadFailureProvider extends TestProvider {
  reads = 0;
  failCommitRead = true;

  override async getIssue(issueId: number): Promise<Issue> {
    this.reads += 1;

    if (this.failCommitRead && this.reads === 3) throw new Error("local commit read-back failed");

    return super.getIssue(issueId);
  }
}

describe("managed issue creation transaction", () => {
  it("creates one provider issue for concurrent requests sharing an idempotency key", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new TestProvider();
      const [first, second] = await Promise.all([
        createManagedTaskIssue(input(workspaceDir, provider, "same-key")),
        createManagedTaskIssue(input(workspaceDir, provider, "same-key")),
      ]);

      assert.strictEqual(first.status, "ready");
      assert.strictEqual(second.status, "ready");
      assert.strictEqual(provider.calls.filter((call) => call.method === "createIssue").length, 1);
      assert.deepStrictEqual(first.issue?.labels, provider.issues.get(1)?.labels);
    });
  });

  it("rejects reuse of an idempotency key for a different payload", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new TestProvider();
      await createManagedTaskIssue(input(workspaceDir, provider, "conflict"));

      await assert.rejects(
        createManagedTaskIssue({ ...input(workspaceDir, provider, "conflict"), title: "Different task" }),
        /different creation payload/,
      );
      assert.strictEqual(provider.calls.filter((call) => call.method === "createIssue").length, 1);
    });
  });

  it("persists provider identity but not runtime state until read-back succeeds", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new ReadBackFailureProvider();
      const result = await createManagedTaskIssue(input(workspaceDir, provider, "readback"));
      const operation = (await readIssueCreationStore(workspaceDir, project.slug)).operations.readback;

      assert.strictEqual(result.status, "pending");
      assert.strictEqual(operation?.status, ISSUE_CREATION_STATUS.PROVIDER_CREATED);
      assert.strictEqual(operation?.providerIssue?.issueId, 1);
      assert.deepStrictEqual((await readIssueStateStore(workspaceDir, project.slug)).issues, {});

      provider.failReadBack = false;
      const reconciled = await reconcileManagedTaskCreations({
        workspaceDir,
        project,
        providerType: ISSUE_PROVIDER.GITHUB,
        provider,
        workflow: DEFAULT_WORKFLOW,
        roles: ["developer", "architect", "tester", "reviewer"],
        maxItems: 20,
      });

      assert.deepStrictEqual(reconciled.ready, [1]);
      assert.strictEqual((await readIssueStateStore(workspaceDir, project.slug)).issues["1"]?.issueId, 1);
    });
  });

  it("does not mutate the provider when the observed quota is insufficient", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new LimitedProvider();
      const result = await createManagedTaskIssue(input(workspaceDir, provider, "limited"));

      assert.strictEqual(result.status, "pending");
      assert.strictEqual(result.error?.code, "PROVIDER_RATE_LIMITED");
      assert.ok(result.recovery?.nextAttemptAt);
      assert.strictEqual(provider.calls.some((call) => call.method === "createIssue"), false);
    });
  });

  it("keeps a locally committed but unpublished operation out of queue scans", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new LimitedProvider();
      const result = await createManagedTaskIssue(input(workspaceDir, provider, "not-ready"));
      const issue = provider.seedIssue({ iid: 7, labels: ["To Do"], title: "Hidden pending issue" });

      await writeIssueRuntimeState({
        workspaceDir,
        project,
        issue,
        providerType: ISSUE_PROVIDER.GITHUB,
        creationOperationId: result.operationId,
        workflow: DEFAULT_WORKFLOW,
        workflowState: "todo",
        workflowLabel: "To Do",
        assignedRole: "developer",
      });

      const candidate = await findNextIssueForRole(
        provider,
        "developer",
        DEFAULT_WORKFLOW,
        undefined,
        { workspaceDir, projectSlug: project.slug },
      );

      assert.strictEqual(candidate, null);
    });
  });

  it("never retries a create whose provider outcome is unknown", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new UnknownOutcomeProvider();
      const first = await createManagedTaskIssue(input(workspaceDir, provider, "unknown"));
      const second = await createManagedTaskIssue(input(workspaceDir, provider, "unknown"));

      assert.strictEqual(first.status, "manual_repair_required");
      assert.strictEqual(second.status, "manual_repair_required");
      assert.strictEqual(provider.calls.filter((call) => call.method === "createIssue").length, 1);
      assert.deepStrictEqual((await readIssueStateStore(workspaceDir, project.slug)).issues, {});
    });
  });

  it("does not reissue a create when a started mutation has no persisted provider identity", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new LimitedProvider();
      await createManagedTaskIssue(input(workspaceDir, provider, "ambiguous-start"));
      await updateIssueCreationStore(workspaceDir, project.slug, (store) => {
        const operation = store.operations["ambiguous-start"];

        if (!operation) throw new Error("Expected durable creation operation.");
        const started = {
          ...operation,
          status: ISSUE_CREATION_STATUS.CREATING,
          lastError: undefined,
          retryAfter: undefined,
          completedSteps: [...operation.completedSteps, CREATION_STEPS.PROVIDER_STARTED],
          pendingSteps: operation.pendingSteps.filter((step) => step !== CREATION_STEPS.PROVIDER_STARTED),
        };

        return {
          store: { ...store, operations: { ...store.operations, "ambiguous-start": started } },
          result: undefined,
        };
      });

      const result = await createManagedTaskIssue(input(workspaceDir, provider, "ambiguous-start"));

      assert.strictEqual(result.status, "manual_repair_required");
      assert.strictEqual(result.error?.code, "PROVIDER_CREATE_UNKNOWN");
      assert.strictEqual(provider.calls.some((call) => call.method === "createIssue"), false);
    });
  });

  it("retries a known provider failure without treating it as an ambiguous create", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new KnownFailureProvider();
      const first = await createManagedTaskIssue(input(workspaceDir, provider, "known-failure"));
      const second = await createManagedTaskIssue(input(workspaceDir, provider, "known-failure"));

      assert.strictEqual(first.status, "pending");
      assert.strictEqual(first.error?.code, "PROVIDER_CREATE_FAILED");
      assert.strictEqual(second.status, "ready");
      assert.strictEqual(provider.issues.size, 1);
    });
  });

  it("keeps a mismatched projection unpublished until a verified reconciliation", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new ProjectionMismatchProvider();
      const first = await createManagedTaskIssue(input(workspaceDir, provider, "projection-mismatch"));

      assert.strictEqual(first.status, "pending");
      assert.strictEqual(first.error?.code, "PROJECTION_VERIFICATION_FAILED");
      assert.deepStrictEqual((await readIssueStateStore(workspaceDir, project.slug)).issues, {});

      provider.mismatchReadBack = false;
      const recovered = await reconcileManagedTaskCreations({
        workspaceDir,
        project,
        providerType: ISSUE_PROVIDER.GITHUB,
        provider,
        workflow: DEFAULT_WORKFLOW,
        maxItems: 1,
      });

      assert.deepStrictEqual(recovered.ready, [1]);
    });
  });

  it("resumes after local commit read-back fails without creating another provider issue", async () => {
    await withWorkspace(async (workspaceDir) => {
      const provider = new LocalCommitReadFailureProvider();
      const first = await createManagedTaskIssue(input(workspaceDir, provider, "commit-read"));

      assert.strictEqual(first.status, "pending");
      assert.strictEqual((await readIssueCreationStore(workspaceDir, project.slug)).operations["commit-read"]?.status, ISSUE_CREATION_STATUS.PROJECTION_VERIFIED);
      assert.deepStrictEqual((await readIssueStateStore(workspaceDir, project.slug)).issues, {});

      provider.failCommitRead = false;
      const recovered = await reconcileManagedTaskCreations({
        workspaceDir,
        project,
        providerType: ISSUE_PROVIDER.GITHUB,
        provider,
        workflow: DEFAULT_WORKFLOW,
        maxItems: 1,
      });

      assert.deepStrictEqual(recovered.ready, [1]);
      assert.strictEqual(provider.calls.filter((call) => call.method === "createIssue").length, 1);
    });
  });
});
