/** Resolves incoming media only against complete project notification identities. */

import { readOptionalProjects } from "../../../state/index.js";
import { MAX_ATTACHMENT_ISSUE_ID } from "./const.js";
import type { AttachmentMessageRoute, AttachmentProjectContext, AttachmentWorkspace } from "./types.js";

/** Extract unique bounded issue references from message text.
 * @param text - Incoming SDK message text.
 */
export function extractIssueReferences(text: string): number[] {
  return [...new Set([...text.matchAll(/#(\d+)/g)].map(match => Number(match[1]))
    .filter(id => Number.isSafeInteger(id) && id > 0 && id < MAX_ATTACHMENT_ISSUE_ID))];
}

/** Resolve exactly one owner/workspace/project binding; ambiguity and unreadable state fail closed.
 * @param workspaces - SDK-resolved configured agent workspaces.
 * @param route - Complete channel/account/conversation/owner identity.
 */
export async function resolveAttachmentProject(workspaces: readonly AttachmentWorkspace[], route: AttachmentMessageRoute): Promise<AttachmentProjectContext | null> {
  if (!route.channel || !route.accountId || !route.conversationId || !route.agentId) return null;
  const candidates = new Set(workspaces.filter(entry => entry.agentId === route.agentId).map(entry => entry.workspaceDir));
  const matches: AttachmentProjectContext[] = [];

  for (const workspaceDir of candidates) {
    const registry = await readOptionalProjects(workspaceDir);

    for (const project of Object.values(registry?.projects ?? {})) {
      if (project.agentId !== route.agentId) continue;
      if (project.channels.some(endpoint => endpoint.channel === route.channel && endpoint.accountId === route.accountId
        && endpoint.channelId === route.conversationId && endpoint.threadId === route.threadId)) {
        matches.push({ workspaceDir, project });
      }
    }
  }

  if (matches.length > 1) throw new Error("Incoming attachment destination is ambiguous across registered projects.");

  return matches[0] ?? null;
}
