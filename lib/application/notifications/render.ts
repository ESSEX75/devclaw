/** Renders notification event messages without I/O or delivery side effects. */

import { COMPLETION_RESULT, getCompletionEmoji, REVIEW_POLICY } from "../../domain/index.js";
import { WORKER_SESSION_ACTION } from "../workers/const.js";
import {
  MERGE_ACTOR_TEXT,
  MERGE_REQUEST_PATH_SEGMENT,
  NOTIFICATION_EVENT,
  PULL_REQUEST_NUMBER_PATTERN,
  WORKER_RESULT_TEXT,
} from "./const.js";
import type { NotifyEvent } from "./types.js";

/** Issue identity required to render the common provider link. */
type NotificationIssueLink = {
  /** Provider-local issue number. */
  issueId: number;
  /** Absolute provider issue URL. */
  issueUrl: string;
};

/**
 * Render built-in worker results and preserve custom result names.
 * @param result - Worker completion result from the event.
 */
function workerResultText(result: string): string {
  switch (result) {
    case COMPLETION_RESULT.DONE:
      return WORKER_RESULT_TEXT[COMPLETION_RESULT.DONE];
    case COMPLETION_RESULT.PASS:
      return WORKER_RESULT_TEXT[COMPLETION_RESULT.PASS];
    case COMPLETION_RESULT.FAIL:
      return WORKER_RESULT_TEXT[COMPLETION_RESULT.FAIL];
    case COMPLETION_RESULT.REFINE:
      return WORKER_RESULT_TEXT[COMPLETION_RESULT.REFINE];
    case COMPLETION_RESULT.BLOCKED:
      return WORKER_RESULT_TEXT[COMPLETION_RESULT.BLOCKED];
    default:
      return result;
  }
}

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
 * @param role - Configured role displayed in upper case.
 * @param opts - Optional worker name and level for the label.
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
 * @param url - Provider pull request or merge request URL.
 */
function extractPrNumber(url: string): number | null {
  const m = url.match(PULL_REQUEST_NUMBER_PATTERN);

  return m ? Number(m[1]) : null;
}

/**
 * Format a PR/MR link with a descriptive label including the PR number.
 * Example: [Pull Request #253](url) or [Merge Request #253](url)
 * @param url - Provider pull request or merge request URL.
 */
function prLink(url: string): string {
  const num = extractPrNumber(url);
  const isGitLab = url.includes(MERGE_REQUEST_PATH_SEGMENT);
  const label = isGitLab
    ? `Merge Request${num != null ? ` #${num}` : ""}`
    : `Pull Request${num != null ? ` #${num}` : ""}`;

  return `[${label}](${url})`;
}

/** Render optional PR context and the issue link shared by event messages.
 * @param issue - Issue shown as the final link.
 * @param prUrl - Related pull request URL when one exists.
 */
function relatedLinks(issue: NotificationIssueLink, prUrl?: string): string {
  return `${prUrl ? `\n🔗 ${prLink(prUrl)}` : ""}\n📋 [Issue #${issue.issueId}](${issue.issueUrl})`;
}

/**
 * Build a human-readable message for a notification event.
 * @param event - Lifecycle event rendered without I/O.
 */
export function renderNotificationMessage(event: NotifyEvent): string {
  switch (event.type) {
    case NOTIFICATION_EVENT.PIPELINE_COMPLETE: {
      let message = `✅ Pipeline completed #${event.issueId}: ${event.issueTitle}`;

      message += `\nFinal state: ${event.terminalState}`;
      if (event.mergeResult) message += `\nMerge: ${event.mergeResult}`;
      if (event.testResult) message += `\nTests: ${event.testResult}`;
      if (event.issueClosed) message += "\nIssue closed";
      message += relatedLinks(event, event.pullRequestUrl);

      return message;
    }

    case NOTIFICATION_EVENT.WORKER_START: {
      const action = event.sessionAction === WORKER_SESSION_ACTION.SPAWN ? "🚀 Started" : "▶️ Resumed";
      const worker = formatWorkerString(event.role, {
        name: event.name,
        level: event.level,
      });

      return `${action} ${worker} on #${event.issueId}: ${event.issueTitle}\n🔗 [Issue #${event.issueId}](${event.issueUrl})`;
    }

    case NOTIFICATION_EVENT.WORKER_COMPLETE: {
      const icon = getCompletionEmoji(event.result);
      const text = workerResultText(event.result);
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
      msg += relatedLinks(event, event.prUrl);
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

    case NOTIFICATION_EVENT.REVIEW_NEEDED: {
      const icon = event.routing === REVIEW_POLICY.HUMAN ? "👀" : "🤖";
      const who = event.routing === REVIEW_POLICY.HUMAN ? "Human review needed" : "Agent review queued";
      let msg = `${icon} ${who} for #${event.issueId}: ${event.issueTitle}`;

      msg += relatedLinks(event, event.prUrl);

      return msg;
    }

    case NOTIFICATION_EVENT.PR_MERGED: {
      let msg = `🔀 PR merged for #${event.issueId}: ${event.issueTitle}`;

      if (event.prTitle) msg += `\n📝 ${event.prTitle}`;
      if (event.sourceBranch && event.targetBranch) {
        msg += `\n🌿 ${event.sourceBranch} → ${event.targetBranch}`;
      } else if (event.sourceBranch) {
        msg += `\n🌿 ${event.sourceBranch}`;
      }

      msg += `\n⚡ ${MERGE_ACTOR_TEXT[event.mergedBy]}`;
      msg += relatedLinks(event, event.prUrl);

      return msg;
    }

    case NOTIFICATION_EVENT.CHANGES_REQUESTED: {
      let msg = `⚠️ Changes requested on PR for #${event.issueId}: ${event.issueTitle}`;

      msg += relatedLinks(event, event.prUrl);
      msg += `\n→ ${event.nextState}`;

      return msg;
    }

    case NOTIFICATION_EVENT.MERGE_CONFLICT: {
      let msg = `⚠️ Merge conflicts detected on PR for #${event.issueId}: ${event.issueTitle}`;

      msg += relatedLinks(event, event.prUrl);
      msg += `\n→ ${event.nextState}`;

      return msg;
    }

    case NOTIFICATION_EVENT.PR_CLOSED: {
      let msg = `🚫 PR closed without merging for #${event.issueId}: ${event.issueTitle}`;

      msg += relatedLinks(event, event.prUrl);
      msg += `\n→ ${event.nextState}`;

      return msg;
    }
  }
}
