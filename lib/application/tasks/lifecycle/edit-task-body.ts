/** Edits user task content under the issue lock while retaining authoritative managed metadata. */

import { log as auditLog } from "../../../audit.js";
import { DEFAULT_ROLES, getInitialStateLabel, STATE_TYPE } from "../../../domain/index.js";
import { composeManagedIssueBody, extractIssueCreationMarker } from "../../../projection/index.js";
import { isIssueCreationReady, loadConfig, withIssueOrchestrationLock } from "../../../state/index.js";
import { ISSUE_RUNTIME_KIND } from "../../issue-runtime/const.js";
import { resolveIssueRuntimeState } from "../../issue-runtime/index.js";
import { resolveProject, resolveProvider } from "../../projects/index.js";
import { EYES_EMOJI } from "../../review/index.js";
import { TASK_EDIT_PREVIEW_LENGTH, TASK_EVENT } from "./const.js";
import type { EditTaskBodyInput } from "./types.js";

/** Before and after user content retained for a bounded audit preview. */
type ContentChange = {
  /** Provider content before this edit. */
  from: string;
  /** Canonical content submitted by this edit. */
  to: string;
};

/** Serialize edits against task lifecycle transitions.
 * @param input - Requested content changes and project/provider transport.
 */
export async function editTaskBody(input: EditTaskBodyInput) {
  const { project } = await resolveProject(input.workspaceDir, input.channelId);

  return withIssueOrchestrationLock(input.workspaceDir, project.slug, input.issueId, () => editTaskBodyLocked(input));
}

/** Validate fresh local state before changing provider-visible user content.
 * @param input - Requested content and transport, with the issue lock already held.
 */
async function editTaskBodyLocked(input: EditTaskBodyInput) {
  const {
    workspaceDir,
    channelId,
    issueId,
    title: newTitle,
    body: newBody,
    reason,
    runCommand,
  } = input;
  const addComment = input.addComment ?? true;

  if (newTitle === undefined && newBody === undefined) {
    throw new Error("At least one of 'title' or 'body' must be provided.");
  }

  const { project } = await resolveProject(workspaceDir, channelId);
  const { provider, type: providerType } = await resolveProvider(workspaceDir, project, runCommand);

  const resolvedConfig = await loadConfig(workspaceDir, project.slug);
  const initialStateLabel = getInitialStateLabel(resolvedConfig.workflow);
  const architectActiveStates = Object.values(resolvedConfig.workflow.states)
    .filter((s) => s.type === STATE_TYPE.ACTIVE && s.role === DEFAULT_ROLES.ARCHITECT)
    .map((s) => s.label);
  const editableStates = [initialStateLabel, ...architectActiveStates];
  const editableStateSet: ReadonlySet<string> = new Set(editableStates);

  const issue = await provider.getIssue(issueId);
  const runtimeState = await resolveIssueRuntimeState({ workspaceDir, project, issue, workflow: resolvedConfig.workflow });

  if (runtimeState.kind !== ISSUE_RUNTIME_KIND.MANAGED) {
    throw new Error(`Issue #${issueId} has no local issue state. Backfill or repair local state before task_edit_body.`);
  }

  if (!await isIssueCreationReady(workspaceDir, project.slug, runtimeState.state.creationOperationId)) {
    throw new Error(`Issue #${issueId} creation is not ready.`);
  }

  if (!runtimeState.stateConfig) throw new Error(`Cannot edit issue #${issueId}: its local workflow state does not match the current configuration.`);
  const currentState = runtimeState.workflowLabel;

  if (!currentState || !editableStateSet.has(currentState)) {
    throw new Error(
      `Cannot edit issue #${issueId}: it is in "${currentState ?? "unknown"}", ` +
      `but edits are only allowed in: ${editableStates.map(s => `"${s}"`).join(", ")}. ` +
      `Add a comment instead, or transition the issue first.`,
    );
  }

  const desiredBody = composeManagedIssueBody(newBody ?? issue.description, {
    projectSlug: project.slug, issueId,
  }, runtimeState.state.creationOperationId ?? extractIssueCreationMarker(issue.description));
  const changes: Record<string, ContentChange> = {};

  if (newTitle !== undefined && newTitle !== issue.title) {
    changes.title = { from: issue.title, to: newTitle };
  }

  if (desiredBody !== issue.description) {
    changes.body = { from: issue.description, to: desiredBody };
  }

  if (Object.keys(changes).length === 0) {
    return {
      success: true,
      issueId,
      issueUrl: issue.web_url,
      project: project.name,
      changed: false,
      announcement: `Issue #${issueId} already has the requested content — no changes made.\n🔗 [Issue #${issueId}](${issue.web_url})`,
    };
  }

  const updatedIssue = await provider.editIssue(issueId, {
    ...(newTitle !== undefined ? { title: newTitle } : {}),
    ...(changes.body ? { body: desiredBody } : {}),
  });

  if (addComment) {
    const timestamp = new Date().toISOString();
    const changeLines: string[] = [];

    if (changes.title) changeLines.push(`- **Title** updated`);
    if (changes.body) changeLines.push(`- **Description** updated`);
    const commentBody = [
      `📝 **Issue updated** at ${timestamp}`,
      ...changeLines,
      ...(reason ? [`- **Reason:** ${reason}`] : []),
    ].join("\n");

    provider.addComment(issueId, commentBody).then((commentId) => {
      provider.reactToIssueComment(issueId, commentId, EYES_EMOJI).catch(() => { });
    }).catch((err) => {
      auditLog(workspaceDir, TASK_EVENT.EDIT_BODY_WARNING, {
        step: "addComment", issueId, error: err instanceof Error ? err.message : String(err),
      }).catch(() => { });
    });
  }

  await auditLog(workspaceDir, TASK_EVENT.EDIT_BODY, {
    project: project.name,
    issueId,
    issueUrl: updatedIssue.web_url,
    provider: providerType,
    changes: Object.fromEntries(
      Object.entries(changes).map(([k, v]) => [k, { from: v.from.slice(0, TASK_EDIT_PREVIEW_LENGTH), to: v.to.slice(0, TASK_EDIT_PREVIEW_LENGTH) }]),
    ),
    reason: reason ?? null,
    timestamp: new Date().toISOString(),
  });

  const changedFields = Object.keys(changes).join(" and ");
  let announcement = `✏️ Updated ${changedFields} of #${issueId}: "${updatedIssue.title}"`;

  if (reason) announcement += ` — ${reason}`;
  announcement += `\n🔗 [Issue #${issueId}](${updatedIssue.web_url})`;

  return {
    success: true,
    issueId,
    issueTitle: updatedIssue.title,
    issueUrl: updatedIssue.web_url,
    project: project.name,
    provider: providerType,
    changed: true,
    changes: Object.keys(changes),
    announcement,
  };
}
