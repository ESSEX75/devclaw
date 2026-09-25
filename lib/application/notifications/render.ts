/** Renders notification event messages without I/O or delivery side effects. */
import { getCompletionEmoji } from "../../domain/index.js";
import type { NotifyEvent } from "./types.js";

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
  const m = url.match(/\/(?:pull|merge_requests)\/(\d+)/);

  return m ? Number(m[1]) : null;
}

/**
 * Format a PR/MR link with a descriptive label including the PR number.
 * Example: [Pull Request #253](url) or [Merge Request #253](url)
 * @param url - Provider pull request or merge request URL.
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
 * @param event - Lifecycle event rendered without I/O.
 */
export function renderNotificationMessage(event: NotifyEvent): string {
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
