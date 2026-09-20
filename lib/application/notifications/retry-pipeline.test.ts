/**
 * Verifies heartbeat recovery of durable terminal pipeline notifications.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  PIPELINE_NOTIFICATION_STATUS,
  type IssueRuntimeState,
} from "../../domain/index.js";
import { readIssueStateStore } from "../../state/index.js";
import {
  createEmptyIssueStateStoreForTesting,
  createTestHarness,
  replaceIssueStateStoreForTesting,
} from "../../testing/index.js";
import type { NotificationRuntime } from "./notify.js";
import { retryPendingPipelineNotifications } from "./retry-pipeline.js";

/**
 * Build one terminal issue whose previous notification attempt lease has expired.
 *
 * @param projectSlug - Canonical project that owns the fixture.
 */
function pendingTerminalIssue(projectSlug: string): IssueRuntimeState {
  return {
    projectSlug,
    issueId: 42,
    provider: ISSUE_PROVIDER.GITHUB,
    workflowState: "done",
    workflowLabel: "Done",
    assignedRole: null,
    assignedLevel: null,
    owner: "main",
    reviewPolicy: null,
    testPolicy: null,
    notifyTarget: { channel: "telegram", name: "primary" },
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    closedAt: "2026-01-01T00:00:00.000Z",
    providerMissing: null,
    pipelineNotification: {
      eventKey: "pipelineComplete:done",
      status: PIPELINE_NOTIFICATION_STATUS.ATTEMPTING,
      attemptedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

/**
 * Build the minimum routed runtime required for successful Telegram delivery.
 *
 * @param sentPayloads - Collector receiving each transport payload.
 */
function notificationRuntime(sentPayloads: unknown[]): NotificationRuntime {
  return {
    config: {
      current: () => ({
        agents: { list: [{ id: "test-agent" }] },
        channels: { telegram: { enabled: true, accounts: { default: {} } } },
        bindings: [{
          agentId: "test-agent",
          match: {
            channel: "telegram",
            accountId: "default",
            peer: { id: "telegram:123" },
          },
        }],
      }),
    },
    channel: {
      outbound: {
        loadAdapter: async () => ({
          sendText: async (payload: unknown) => {
            sentPayloads.push(payload);

            return { messageId: "message-42" };
          },
        }),
      },
    },
  };
}

describe("retryPendingPipelineNotifications", () => {
  it("retries an expired attempt and confirms delivery in active state", async () => {
    const harness = await createTestHarness({ projectName: "test-project", channelId: "telegram:123" });
    const store = createEmptyIssueStateStoreForTesting(harness.project.slug);
    const sentPayloads: unknown[] = [];

    try {
      store.issues["42"] = pendingTerminalIssue(harness.project.slug);
      await replaceIssueStateStoreForTesting(harness.workspaceDir, harness.project.slug, store);
      harness.provider.seedIssue({ iid: 42, title: "Completed issue" });

      const delivered = await retryPendingPipelineNotifications(
        harness.workspaceDir,
        harness.project,
        harness.provider,
        undefined,
        notificationRuntime(sentPayloads),
        harness.runCommand,
        10,
      );
      const state = (await readIssueStateStore(harness.workspaceDir, harness.project.slug)).issues["42"];

      assert.equal(delivered, 1);
      assert.equal(sentPayloads.length, 1);
      assert.equal(state?.pipelineNotification?.status, PIPELINE_NOTIFICATION_STATUS.DELIVERED);
      assert.ok(state?.pipelineNotification?.deliveredAt);
    } finally {
      await harness.cleanup();
    }
  });
});
