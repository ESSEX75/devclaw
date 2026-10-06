/**
 * Verifies heartbeat recovery of durable terminal pipeline notifications.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_WORKFLOW,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  PIPELINE_NOTIFICATION_STATUS,
  type IssueRuntimeState,
} from "../../domain/index.js";
import { readIssueArchiveStore, readIssueStateStore, reservePipelineNotification, settlePipelineNotification } from "../../state/index.js";
import {
  createEmptyIssueStateStoreForTesting,
  createTestHarness,
  replaceIssueStateStoreForTesting,
} from "../../testing/index.js";
import { recoverTerminalIssueArchives } from "../issues/archive/index.js";
import type { NotificationRuntime } from "./index.js";
import { retryPendingPipelineNotifications } from "./retry-pipeline.js";

/**
 * Build one terminal issue whose previous proven non-send backoff has expired.
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    closedAt: "2026-01-01T00:00:00.000Z",
    providerMissing: null,
    pipelineNotification: {
      eventKey: "pipelineComplete:done",
      status: PIPELINE_NOTIFICATION_STATUS.RETRYABLE,
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
            peer: { kind: "group", id: "telegram:123" },
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
  it("retries a proven non-send and confirms delivery in active state", async () => {
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

  it("does not let a backoff attempt consume the only send slot", async () => {
    const h = await createTestHarness({ projectName: "test-project", channelId: "telegram:123" });
    const store = createEmptyIssueStateStoreForTesting(h.project.slug);
    const sent: unknown[] = [];

    try {
      const waiting = pendingTerminalIssue(h.project.slug);

      waiting.issueId = 41;
      const waitingMarker = waiting.pipelineNotification;

      assert.ok(waitingMarker);
      waitingMarker.attemptedAt = new Date(Date.now() - 1_000).toISOString();
      const ready = pendingTerminalIssue(h.project.slug);

      const readyMarker = ready.pipelineNotification;

      assert.ok(readyMarker);
      readyMarker.status = PIPELINE_NOTIFICATION_STATUS.PENDING;
      readyMarker.attemptedAt = new Date().toISOString();
      store.issues["41"] = waiting;
      store.issues["42"] = ready;
      await replaceIssueStateStoreForTesting(h.workspaceDir, h.project.slug, store);
      h.provider.seedIssue({ iid: 42, title: "Ready issue" });

      const delivered = await retryPendingPipelineNotifications(
        h.workspaceDir, h.project, h.provider, undefined, notificationRuntime(sent), h.runCommand, 1,
      );
      const persisted = await readIssueStateStore(h.workspaceDir, h.project.slug);

      assert.equal(delivered, 1);
      assert.equal(sent.length, 1);
      assert.equal(persisted.issues["41"].pipelineNotification?.status, PIPELINE_NOTIFICATION_STATUS.RETRYABLE);
      assert.equal(persisted.issues["42"].pipelineNotification?.status, PIPELINE_NOTIFICATION_STATUS.DELIVERED);
    } finally {
      await h.cleanup();
    }
  });
});


for (const scenario of ["disabled", "missing endpoint", "missing issue", "lost response", "expired in-flight"]) {
  it(`retains ${scenario} evidence without a duplicate send`, async () => {
    const h = await createTestHarness({ projectName: "test-project", channelId: "telegram:123" });
    const store = createEmptyIssueStateStoreForTesting(h.project.slug);
    const sent: unknown[] = [];
    const runtime = notificationRuntime(sent);
    if (scenario === "lost response") runtime.channel.outbound.loadAdapter = async () => ({
      sendText: async (payload: unknown) => { sent.push(payload); throw new Error("Response lost after send"); },
    });
    try {
      const state = pendingTerminalIssue(h.project.slug);
      if (scenario === "missing endpoint") state.notifyTarget = { channel: "telegram", name: "removed" };
      if (scenario === "expired in-flight" && state.pipelineNotification) state.pipelineNotification.status = PIPELINE_NOTIFICATION_STATUS.ATTEMPTING;
      store.issues["42"] = state;
      await replaceIssueStateStoreForTesting(h.workspaceDir, h.project.slug, store);
      if (scenario !== "missing issue") h.provider.seedIssue({ iid: 42 });
      const config = scenario === "disabled" ? { notifications: { pipelineComplete: false } } : undefined;
      for (let pass = 0; pass < 2; pass++) {
        assert.equal(await retryPendingPipelineNotifications(h.workspaceDir, h.project, h.provider, config, runtime, h.runCommand, 10), 0);
      }
      const marker = (await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].pipelineNotification;
      assert.equal(marker?.status, scenario === "lost response" || scenario === "expired in-flight" ? PIPELINE_NOTIFICATION_STATUS.UNKNOWN : PIPELINE_NOTIFICATION_STATUS.BLOCKED);
      assert.ok(marker?.reason);
      assert.equal(marker?.deliveredAt, undefined);
      assert.equal(sent.length, scenario === "lost response" ? 1 : 0);
      assert.equal(h.commands.commandsFor("openclaw").filter((command) => command.argv[1] === "message").length, 0);
    } finally {
      await h.cleanup();
    }
  });
}

it("concurrent retry passes send the same reserved event only once", async () => {
  const h = await createTestHarness({ projectName: "test-project", channelId: "telegram:123" });
  const store = createEmptyIssueStateStoreForTesting(h.project.slug);
  const sent: unknown[] = [];
  try {
    store.issues["42"] = pendingTerminalIssue(h.project.slug);
    await replaceIssueStateStoreForTesting(h.workspaceDir, h.project.slug, store);
    h.provider.seedIssue({ iid: 42 });
    const outcomes = await Promise.all([1, 2].map(() => retryPendingPipelineNotifications(
      h.workspaceDir, h.project, h.provider, undefined, notificationRuntime(sent), h.runCommand, 10,
    )));
    assert.equal(outcomes.reduce((sum, value) => sum + value, 0), 1);
    assert.equal(sent.length, 1);
  } finally {
    await h.cleanup();
  }
});

it("rejects stale attempt results after a safely retryable event is reserved again", async () => {
  const h = await createTestHarness();
  const store = createEmptyIssueStateStoreForTesting(h.project.slug);
  try {
    store.issues["42"] = pendingTerminalIssue(h.project.slug);
    await replaceIssueStateStoreForTesting(h.workspaceDir, h.project.slug, store);
    const first = await reservePipelineNotification(h.workspaceDir, h.project.slug, 42, "pipelineComplete:done", new Date("2026-02-01"));
    assert.ok(first);
    await settlePipelineNotification(h.workspaceDir, h.project.slug, 42, "pipelineComplete:done", first, PIPELINE_NOTIFICATION_STATUS.RETRYABLE, "No sender");
    const second = await reservePipelineNotification(h.workspaceDir, h.project.slug, 42, "pipelineComplete:done", new Date("2026-03-01"));
    assert.ok(second);
    assert.notEqual(first, second);
    assert.equal(await settlePipelineNotification(h.workspaceDir, h.project.slug, 42, "pipelineComplete:done", first, PIPELINE_NOTIFICATION_STATUS.DELIVERED), false);
    assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].pipelineNotification?.status, PIPELINE_NOTIFICATION_STATUS.ATTEMPTING);
  } finally {
    await h.cleanup();
  }
});

it("retries a blocked Telegram DM only through its direct binding and archives after delivery", async () => {
  const h = await createTestHarness({ projectName: "test-project", channelId: "931077226" });
  const store = createEmptyIssueStateStoreForTesting(h.project.slug);
  const sent: unknown[] = [];
  const runtime = notificationRuntime(sent);
  let peerKind = "group";

  runtime.config.current = () => ({
    agents: { list: [{ id: "test-agent" }] },
    channels: { telegram: { enabled: true, accounts: { default: {} } } },
    bindings: [{ agentId: "test-agent", match: { channel: "telegram", accountId: "default", peer: { kind: peerKind, id: "931077226" } } }],
  });
  try {
    store.issues["42"] = pendingTerminalIssue(h.project.slug);
    await replaceIssueStateStoreForTesting(h.workspaceDir, h.project.slug, store);
    h.provider.seedIssue({ iid: 42, title: "Completed issue" });
    assert.equal(await retryPendingPipelineNotifications(h.workspaceDir, h.project, h.provider, undefined, runtime, h.runCommand, 1), 0);
    assert.equal(sent.length, 0);
    assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].pipelineNotification?.status, PIPELINE_NOTIFICATION_STATUS.BLOCKED);
    assert.deepEqual((await recoverTerminalIssueArchives({ workspaceDir: h.workspaceDir, projectSlug: h.project.slug, workflow: DEFAULT_WORKFLOW, maxItems: 1 })).archived, []);
    assert.equal(Object.keys((await readIssueArchiveStore(h.workspaceDir, h.project.slug)).issues).length, 0);

    peerKind = "direct";
    const blocked = await readIssueStateStore(h.workspaceDir, h.project.slug);
    const marker = blocked.issues["42"].pipelineNotification;

    assert.ok(marker);
    marker.attemptedAt = "2026-01-01T00:00:00.000Z";
    await replaceIssueStateStoreForTesting(h.workspaceDir, h.project.slug, blocked);
    assert.equal(await retryPendingPipelineNotifications(h.workspaceDir, h.project, h.provider, undefined, runtime, h.runCommand, 1), 1);
    assert.equal(sent.length, 1);
    assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"].pipelineNotification?.status, PIPELINE_NOTIFICATION_STATUS.DELIVERED);
    assert.deepEqual((await recoverTerminalIssueArchives({ workspaceDir: h.workspaceDir, projectSlug: h.project.slug, workflow: DEFAULT_WORKFLOW, maxItems: 1 })).archived, [42]);
    assert.equal((await readIssueStateStore(h.workspaceDir, h.project.slug)).issues["42"], undefined);
    assert.ok(Object.values((await readIssueArchiveStore(h.workspaceDir, h.project.slug)).issues).some(record => record.issueId === 42));
  } finally {
    await h.cleanup();
  }
});
