/** Renders a completion announcement without provider or state access. */

import { getCompletionEmoji } from "../../domain/index.js";
import type { CompletionInput } from "./types.js";

/** Render the configured result and links for the completing worker.
 * @param opts - User-facing completion context.
 * @param issueUrl - Observed provider issue URL.
 * @param prUrl - Observed pull request URL.
 * @param nextState - Configured destination description.
 */
export function renderCompletionAnnouncement(opts: CompletionInput, issueUrl: string, prUrl: string | undefined, nextState: string): string {
  const { role, result, issueId, summary, createdTasks } = opts;
  const key = `${role}:${result}`;
  // Build announcement using workflow-derived emoji
  const emoji = getCompletionEmoji(result);
  const label = key.replace(":", " ").toUpperCase();
  let announcement = `${emoji} ${label} #${issueId}`;

  if (summary) announcement += ` — ${summary}`;
  announcement += `\n📋 [Issue #${issueId}](${issueUrl})`;
  if (prUrl) announcement += `\n🔗 [PR](${prUrl})`;
  if (createdTasks && createdTasks.length > 0) {
    announcement += `\n📌 Created tasks:`;
    for (const t of createdTasks) {
      announcement += `\n  - [#${t.id}: ${t.title}](${t.url})`;
    }
  }

  announcement += `\n${nextState}.`;

  return announcement;
}
