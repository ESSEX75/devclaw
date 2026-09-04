import { type NotificationEndpoint, type Project,resolveNotifyBinding } from "../../domain/index.js";
import { readIssueStateStore } from "../../state/issues/index.js";

/** Resolve the destination stored in managed local issue state. */
export async function resolveIssueNotificationEndpoint(
  workspaceDir: string,
  project: Pick<Project, "slug" | "channels">,
  issueId: number,
): Promise<NotificationEndpoint | undefined> {
  const store = await readIssueStateStore(workspaceDir, project.slug);
  const binding = store.issues[String(issueId)]?.notifyTarget;

  return binding ? resolveNotifyBinding(binding, project.channels) : undefined;
}
