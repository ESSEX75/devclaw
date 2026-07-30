import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import { getInitialStateLabel } from "../../domain/index.js";
import { loadConfig } from "../../state/config/index.js";
import { resolveIssueRuntimeState } from "../../state/issues/index.js";
import { applyNotifyLabel,autoAssignOwnerLabel, resolveProject, resolveProvider } from "../../tools/helpers.js";

export type EditTaskBodyInput = {
  workspaceDir: string;
  channelId: string;
  issueId: number;
  title?: string;
  body?: string;
  reason?: string;
  addComment?: boolean;
  runCommand: RunCommand;
};

export async function editTaskBody(input: EditTaskBodyInput) {
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

  if (!newTitle && !newBody) {
    throw new Error("At least one of 'title' or 'body' must be provided.");
  }

  const { project } = await resolveProject(workspaceDir, channelId);
  const { provider, type: providerType } = await resolveProvider(project, runCommand);

  const resolvedConfig = await loadConfig(workspaceDir, project.name);
  const initialStateLabel = getInitialStateLabel(resolvedConfig.workflow);
  const architectActiveStates = Object.values(resolvedConfig.workflow.states)
    .filter((s) => s.type === "active" && s.role === "architect")
    .map((s) => s.label);
  const editableStates = [initialStateLabel, ...architectActiveStates];
  const editableStateSet: ReadonlySet<string> = new Set(editableStates);

  const issue = await provider.getIssue(issueId);
  const runtimeState = await resolveIssueRuntimeState({ workspaceDir, project, issue, workflow: resolvedConfig.workflow });

  if (runtimeState.kind !== "managed") {
    throw new Error(`Issue #${issueId} has no local issue state. Backfill or repair local state before task_edit_body.`);
  }

  const currentState = runtimeState.workflowLabel;

  if (!currentState || !editableStateSet.has(currentState)) {
    throw new Error(
      `Cannot edit issue #${issueId}: it is in "${currentState ?? "unknown"}", ` +
      `but edits are only allowed in: ${editableStates.map(s => `"${s}"`).join(", ")}. ` +
      `Add a comment instead, or transition the issue first.`,
    );
  }

  const changes: Record<string, { from: string; to: string }> = {};

  if (newTitle !== undefined && newTitle !== issue.title) {
    changes.title = { from: issue.title, to: newTitle };
  }

  if (newBody !== undefined && newBody !== issue.description) {
    changes.body = { from: issue.description, to: newBody };
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
    ...(newBody !== undefined ? { body: newBody } : {}),
  });

  applyNotifyLabel(provider, issueId, project, channelId, issue.labels);
  autoAssignOwnerLabel(workspaceDir, provider, issueId, project).catch(() => {});

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
      provider.reactToIssueComment(issueId, commentId, "eyes").catch(() => {});
    }).catch((err) => {
      auditLog(workspaceDir, "task_edit_body_warning", {
        step: "addComment", issueId, error: (err as Error).message ?? String(err),
      }).catch(() => {});
    });
  }

  await auditLog(workspaceDir, "task_edit_body", {
    project: project.name,
    issueId,
    issueUrl: updatedIssue.web_url,
    provider: providerType,
    changes: Object.fromEntries(
      Object.entries(changes).map(([k, v]) => [k, { from: v.from.slice(0, 200), to: v.to.slice(0, 200) }]),
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
