/**
 * notify.ts — Programmatic alerting for worker lifecycle events.
 *
 * Sends notifications to project groups for visibility into the DevClaw pipeline.
 *
 * Event types:
 * - workerStart: Worker spawned/resumed for a task (→ project group)
 * - workerComplete: Worker completed task (→ project group)
 * - reviewNeeded: Issue needs review — human or agent (→ project group)
 * - prMerged: PR/MR was merged into the base branch (→ project group)
 */
import { randomUUID } from "node:crypto";

import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import { getCompletionEmoji, NOTIFICATION_CHANNEL, type NotificationChannel } from "../../domain/index.js";

/** Per-event-type toggle. All default to true — set to false to suppress. */
export type NotificationConfig = Partial<Record<NotifyEvent["type"], boolean>>;

export type NotificationDeliveryResult = {
  delivered: true;
  messageId?: string;
  channel: NotificationChannel;
  accountId?: string;
  channelId: string;
  threadId?: string;
  path: "runtime" | "fallback";
};

/** Narrow runtime surface required by notification delivery. */
export type NotificationRuntime = {
  config: {
    current(): unknown;
  };
  channel: {
    outbound: {
      loadAdapter(channel: string): Promise<unknown>;
    };
  };
};

export type NotifyEvent =
  | {
      type: "pipelineComplete";
      project: string;
      issueId: number;
      issueTitle: string;
      issueUrl: string;
      terminalState: string;
      pullRequestUrl?: string;
      mergeResult?: string;
      testResult?: string;
      issueClosed: boolean;
    }
  | {
      type: "workerStart";
      project: string;
      issueId: number;
      issueTitle: string;
      issueUrl: string;
      role: string;
      level: string;
      name?: string;
      sessionAction: "spawn" | "send";
    }
  | {
      type: "workerComplete";
      project: string;
      issueId: number;
      issueUrl: string;
      role: string;
      level?: string;
      name?: string;
      result: string;
      summary?: string;
      nextState?: string;
      prUrl?: string;
      createdTasks?: Array<{ id: number; title: string; url: string }>;
    }
  | {
      type: "reviewNeeded";
      project: string;
      issueId: number;
      issueUrl: string;
      issueTitle: string;
      routing: "human" | "agent";
      prUrl?: string;
    }
  | {
      type: "prMerged";
      project: string;
      issueId: number;
      issueUrl: string;
      issueTitle: string;
      prUrl?: string;
      prTitle?: string;
      sourceBranch?: string;
      targetBranch?: string;
      mergedBy: "heartbeat" | "agent" | "pipeline";
    }
  | {
      type: "changesRequested";
      project: string;
      issueId: number;
      issueUrl: string;
      issueTitle: string;
      prUrl?: string;
    }
  | {
      type: "mergeConflict";
      project: string;
      issueId: number;
      issueUrl: string;
      issueTitle: string;
      prUrl?: string;
    }
  | {
      type: "prClosed";
      project: string;
      issueId: number;
      issueUrl: string;
      issueTitle: string;
      prUrl?: string;
    };

/**
 * Format a worker identification string in a standardized format.
 *
 * Combines role, worker name, and level into a consistent format:
 * - "DEVELOPER" (no name/level)
 * - "DEVELOPER Herminia" (name only)
 * - "DEVELOPER (junior)" (level only)
 * - "DEVELOPER Herminia (junior)" (name and level)
 *
 * This ensures consistency across all notifications that reference a worker.
 */
function formatWorkerString(
  role: string,
  opts?: { name?: string; level?: string },
): string {
  const roleUpper = role.toUpperCase();
  const parts = [roleUpper];

  if (opts?.name) {
    parts.push(opts.name);
  }

  if (opts?.level) {
    parts.push(`(${opts.level})`);
  }

  return parts.join(" ");
}

/**
 * Extract a PR/MR number from a URL.
 * GitHub: .../pull/123  GitLab: .../merge_requests/123
 * Returns null if not parseable.
 */
function extractPrNumber(url: string): number | null {
  const m = url.match(/\/(?:pull|merge_requests)\/(\d+)/);

  return m ? Number(m[1]) : null;
}

/**
 * Format a PR/MR link with a descriptive label including the PR number.
 * Example: [Pull Request #253](url) or [Merge Request #253](url)
 */
function prLink(url: string): string {
  const num = extractPrNumber(url);
  const isGitLab = url.includes("merge_requests");
  const label = isGitLab
    ? `Merge Request${num != null ? ` #${num}` : ""}`
    : `Pull Request${num != null ? ` #${num}` : ""}`;

  return `[${label}](${url})`;
}

/**
 * Build a human-readable message for a notification event.
 */
function buildMessage(event: NotifyEvent): string {
  switch (event.type) {
    case "pipelineComplete": {
      let message = `✅ Pipeline completed #${event.issueId}: ${event.issueTitle}`;

      message += `\nFinal state: ${event.terminalState}`;
      if (event.mergeResult) message += `\nMerge: ${event.mergeResult}`;
      if (event.testResult) message += `\nTests: ${event.testResult}`;
      if (event.issueClosed) message += "\nIssue closed";
      if (event.pullRequestUrl) message += `\n🔗 ${prLink(event.pullRequestUrl)}`;
      message += `\n📋 [Issue #${event.issueId}](${event.issueUrl})`;

      return message;
    }

    case "workerStart": {
      const action = event.sessionAction === "spawn" ? "🚀 Started" : "▶️ Resumed";
      const worker = formatWorkerString(event.role, {
        name: event.name,
        level: event.level,
      });

      return `${action} ${worker} on #${event.issueId}: ${event.issueTitle}\n🔗 [Issue #${event.issueId}](${event.issueUrl})`;
    }

    case "workerComplete": {
      const icon = getCompletionEmoji(event.result);
      const resultText: Record<string, string> = {
        done: "completed",
        pass: "PASSED",
        fail: "FAILED",
        refine: "needs refinement",
        blocked: "BLOCKED",
      };
      const text = resultText[event.result] ?? event.result;
      // Header: status + issue reference
      const worker = formatWorkerString(event.role, {
        name: event.name,
        level: event.level,
      });
      let msg = `${icon} ${worker} ${text} #${event.issueId}`;

      // Summary: on its own line for readability
      if (event.summary) {
        msg += `\n${event.summary}`;
      }

      // Links: PR and issue on separate lines
      if (event.prUrl) msg += `\n🔗 ${prLink(event.prUrl)}`;
      msg += `\n📋 [Issue #${event.issueId}](${event.issueUrl})`;
      // Created tasks (e.g. architect implementation tasks)
      if (event.createdTasks && event.createdTasks.length > 0) {
        msg += `\n📌 Created tasks:`;
        for (const t of event.createdTasks) {
          msg += `\n  · [#${t.id}: ${t.title}](${t.url})`;
        }

        msg += `\nReply to start working on them.`;
      }

      // Workflow transition: at the end
      if (event.nextState) {
        msg += `\n→ ${event.nextState}`;
      }

      return msg;
    }

    case "reviewNeeded": {
      const icon = event.routing === "human" ? "👀" : "🤖";
      const who = event.routing === "human" ? "Human review needed" : "Agent review queued";
      let msg = `${icon} ${who} for #${event.issueId}: ${event.issueTitle}`;

      if (event.prUrl) msg += `\n🔗 ${prLink(event.prUrl)}`;
      msg += `\n📋 [Issue #${event.issueId}](${event.issueUrl})`;

      return msg;
    }

    case "prMerged": {
      const via: Record<string, string> = {
        heartbeat: "auto-merged after approval",
        agent: "merged by agent reviewer",
        pipeline: "merged by reviewer",
      };
      let msg = `🔀 PR merged for #${event.issueId}: ${event.issueTitle}`;

      if (event.prTitle) msg += `\n📝 ${event.prTitle}`;
      if (event.sourceBranch && event.targetBranch) {
        msg += `\n🌿 ${event.sourceBranch} → ${event.targetBranch}`;
      } else if (event.sourceBranch) {
        msg += `\n🌿 ${event.sourceBranch}`;
      }

      msg += `\n⚡ ${via[event.mergedBy] ?? event.mergedBy}`;
      if (event.prUrl) msg += `\n🔗 ${prLink(event.prUrl)}`;
      msg += `\n📋 [Issue #${event.issueId}](${event.issueUrl})`;

      return msg;
    }

    case "changesRequested": {
      let msg = `⚠️ Changes requested on PR for #${event.issueId}: ${event.issueTitle}`;

      if (event.prUrl) msg += `\n🔗 ${prLink(event.prUrl)}`;
      msg += `\n📋 [Issue #${event.issueId}](${event.issueUrl})`;
      msg += `\n→ Moving to To Improve for developer re-dispatch`;

      return msg;
    }

    case "mergeConflict": {
      let msg = `⚠️ Merge conflicts detected on PR for #${event.issueId}: ${event.issueTitle}`;

      if (event.prUrl) msg += `\n🔗 ${prLink(event.prUrl)}`;
      msg += `\n📋 [Issue #${event.issueId}](${event.issueUrl})`;
      msg += `\n→ Moving to To Improve — developer will rebase and resolve`;

      return msg;
    }

    case "prClosed": {
      let msg = `🚫 PR closed without merging for #${event.issueId}: ${event.issueTitle}`;

      if (event.prUrl) msg += `\n🔗 ${prLink(event.prUrl)}`;
      msg += `\n📋 [Issue #${event.issueId}](${event.issueUrl})`;
      msg += `\n→ Moving to To Improve for developer attention`;

      return msg;
    }
  }
}

/**
 * Send a notification message via the plugin runtime API.
 *
 * Uses the runtime's native send functions to bypass CLI → WebSocket timeouts.
 * Falls back gracefully on error (notifications shouldn't break the main flow).
 */
async function sendMessage(
  target: string,
  message: string,
  channel: NotificationChannel,
  runtime?: NotificationRuntime,
  accountId?: string,
  threadId?: string,
  runCommand?: RunCommand,
): Promise<NotificationDeliveryResult> {
  let runtimeError: unknown;

  // Use runtime API when available (avoids CLI subprocess timeouts)
  const adapter: unknown = runtime
    ? await runtime.channel.outbound.loadAdapter(channel)
    : undefined;

  if (hasRuntimeSender(adapter) && runtime) {
    try {
      const receipt: unknown = await adapter.sendText({
        cfg: runtime.config.current(),
        to: target,
        text: message,
        silent: true,
        accountId,
        threadId,
      });

      return {
        delivered: true,
        ...(getMessageId(receipt) ? { messageId: getMessageId(receipt) } : {}),
        channel,
        accountId,
        channelId: target,
        threadId,
        path: "runtime",
      };
    } catch (err) {
      runtimeError = err;
    }
  }

  const args = [
    "message",
    "send",
    "--channel",
    channel,
    "--target",
    target,
    "--message",
    message,
    "--json",
  ];

  if (!runCommand) {
    throw new Error(hasRuntimeSender(adapter)
      ? `Runtime notification failed and no command runner is available for fallback: ${errorMessage(runtimeError)}`
      : "No notification delivery path available");
  }

  if (accountId) args.push("--account", accountId);
  if (threadId) args.push("--thread-id", threadId);

  await runCommand(["openclaw", ...args], { timeoutMs: 30_000 });

  return {
    delivered: true,
    channel,
    accountId,
    channelId: target,
    threadId,
    path: "fallback",
  };
}

type RuntimeSendPayload = {
  cfg: unknown;
  to: string;
  text: string;
  silent: boolean;
  accountId?: string;
  threadId?: string;
};

function hasRuntimeSender(value: unknown): value is {
  sendText(payload: RuntimeSendPayload): Promise<unknown>;
} {
  return typeof value === "object"
    && value !== null
    && "sendText" in value
    && typeof value.sendText === "function";
}

function getMessageId(value: unknown): string | undefined {
  return typeof value === "object"
    && value !== null
    && "messageId" in value
    && typeof value.messageId === "string"
    ? value.messageId
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Send a notification for a worker lifecycle event.
 *
 * Returns true if notification was sent, false on error.
 */
export async function notify(
  event: NotifyEvent,
  opts: {
    workspaceDir: string;
    config?: NotificationConfig;
    /** Target for project-scoped notifications (channelId) */
    channelId?: string;
    /** Channel type for routing (e.g. "telegram", "whatsapp", "discord", "slack") */
    channel?: NotificationChannel;
    /** Optional thread/topic ID for forum-style channels */
    threadId?: string;
    /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
    runtime?: NotificationRuntime;
    /** Optional account ID for multi-account setups */
    accountId?: string;
    /** Injected runCommand for dependency injection. */
    runCommand?: RunCommand;
  },
): Promise<NotificationDeliveryResult | null> {
  if (opts.config?.[event.type] === false) return null;

  const channel = opts.channel ?? NOTIFICATION_CHANNEL.TELEGRAM;
  const message = buildMessage(event);
  const target = opts.channelId;

  if (!target) {
    await auditLog(opts.workspaceDir, "notify_skip", {
      eventType: event.type,
      reason: "no target",
    });

    return null;
  }

  const eventId = randomUUID();
  const deliveryPaths = [opts.runtime ? "runtime" : null, opts.runCommand ? "fallback" : null].filter(Boolean);
  const targetData = {
    channel,
    accountId: opts.accountId,
    channelId: target,
    threadId: opts.threadId,
  };

  await auditLog(opts.workspaceDir, "notify_attempt", {
    eventId,
    eventType: event.type,
    project: event.project,
    issueId: event.issueId,
    target: targetData,
    paths: deliveryPaths,
  });

  try {
    const result = await sendMessage(
      target,
      message,
      channel,
      opts.runtime,
      opts.accountId,
      opts.threadId,
      opts.runCommand,
    );

    await auditLog(opts.workspaceDir, "notify_sent", {
      eventId,
      eventType: event.type,
      project: event.project,
      issueId: event.issueId,
      target: targetData,
      ...result,
    });

    return result;
  } catch (error) {
    await auditLog(opts.workspaceDir, "notify_failed", {
      eventId,
      eventType: event.type,
      project: event.project,
      issueId: event.issueId,
      target: targetData,
      attempts: deliveryPaths,
      error: errorMessage(error),
    });

    return null;
  }
}

/**
 * Extract notification config from plugin config.
 * All event types default to enabled (true).
 */
export function getNotificationConfig(
  pluginConfig?: Record<string, unknown>,
): NotificationConfig {
  return (pluginConfig?.notifications as NotificationConfig) ?? {};
}
