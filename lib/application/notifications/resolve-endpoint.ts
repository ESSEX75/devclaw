/** Resolves an issue's stored notification binding against its owning project. */
import { type NotificationEndpoint, type Project, resolveNotifyBinding } from "../../domain/index.js";
import { readIssueStateStore } from "../../state/index.js";

/**
 * Resolve only the exact destination stored in managed local issue state.
 * An unknown binding yields undefined rather than another project endpoint.
 * @param workspaceDir - Workspace containing authoritative issue state.
 * @param project - Project whose endpoints can satisfy the binding.
 * @param issueId - Provider-local managed issue identifier.
 */
export async function resolveIssueNotificationEndpoint(
  workspaceDir: string,
  project: Pick<Project, "slug" | "channels">,
  issueId: number,
): Promise<NotificationEndpoint | undefined> {
  const store = await readIssueStateStore(workspaceDir, project.slug);
  const binding = store.issues[String(issueId)]?.notifyTarget;

  return binding ? resolveNotifyBinding(binding, project.channels) : undefined;
}
