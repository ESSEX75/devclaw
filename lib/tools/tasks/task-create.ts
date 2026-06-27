/**
 * task_create — Create a new task (issue) in the project's issue tracker.
 *
 * Atomically: creates an issue with the specified title and description in the
 * initial workflow state. Returns the created issue for immediate pickup if desired.
 *
 * Use this when:
 * - You want to create work items from chat
 * - A sub-agent finds a bug and needs to file a follow-up issue
 * - Breaking down an epic into smaller tasks
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../../context.js";
import { log as auditLog } from "../../audit.js";
import { loadConfig } from "../../config/index.js";
import { loadInstanceName } from "../../instance.js";
import {
  StateType,
  WorkflowEvent,
  getOwnerLabel,
  OWNER_LABEL_COLOR,
  NOTIFY_LABEL_PREFIX,
  NOTIFY_LABEL_COLOR,
  type WorkflowConfig,
  type StateConfig,
} from "../../workflow/index.js";
import { requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";
import { writeIssueRuntimeState, type NotifyTarget } from "../../issues/index.js";
import { expectedManagedLabels, replaceIssueMetadata } from "../../projection/index.js";
import type { Issue, IssueProvider } from "../../providers/provider.js";
import type { Project } from "../../projects/index.js";

type CreatedManagedTask = {
  issue: Issue;
  label: string;
  workflowState: string;
  role: string | null;
  announcementSuffix: string;
};

export function createTaskCreateTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_create",
    label: "Task Create",
    description: "Create a new task (issue) in the project's issue tracker. Use this to file bugs, features, or tasks from chat. Issues are queued immediately in the workflow's first developer queue for heartbeat dispatch.",
    parameters: {
      type: "object",
      required: ["channelId", "title"],
      properties: {
        channelId: {
          type: "string",
          description: "YOUR chat/group ID — the numeric ID of the chat you are in right now (e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
        title: {
          type: "string",
          description: "Short, descriptive issue title (e.g., 'Fix login timeout bug')",
        },
        description: {
          type: "string",
          description: "Full issue body in markdown. Use for detailed context, acceptance criteria, reproduction steps, links. Supports GitHub-flavored markdown.",
        },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: "GitHub/GitLab usernames to assign (optional)",
        },
        pickup: {
          type: "boolean",
          description: "If true, immediately pick up this issue for DEV after creation. Defaults to false.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);
      const title = params.title as string;
      const description = (params.description as string) ?? "";
      const assignees = (params.assignees as string[] | undefined) ?? [];
      const pickup = (params.pickup as boolean) ?? false;
      const workspaceDir = requireWorkspaceDir(toolCtx);

      const { project } = await resolveProject(workspaceDir, channelId);
      const { provider, type: providerType } = await resolveProvider(project, ctx.runCommand);
      const resolvedConfig = await loadConfig(workspaceDir, project.name);
      const instanceName = await loadInstanceName(workspaceDir, resolvedConfig.instanceName);
      const sourceChannel = project.channels.find((ch) => ch.channelId === channelId) ?? project.channels[0];
      const notifyTarget: NotifyTarget | null = sourceChannel
        ? { channel: sourceChannel.channel, name: sourceChannel.name }
        : null;

      const created = await createManagedTaskIssue({
        workspaceDir,
        project,
        providerType,
        provider,
        workflow: resolvedConfig.workflow,
        title,
        description,
        assignees,
        notifyTarget,
        owner: instanceName,
      });

      // Mark as system-managed (best-effort).
      provider.reactToIssue(created.issue.iid, "eyes").catch(() => {});

      await auditLog(workspaceDir, "task_create", {
        project: project.name, issueId: created.issue.iid,
        title, label: created.label, provider: providerType, pickup,
      });

      const hasBody = description && description.trim().length > 0;
      let announcement = `📋 Created #${created.issue.iid}: "${title}" (${created.label})`;
      if (hasBody) announcement += "\nWith detailed description.";
      announcement += `\n🔗 [Issue #${created.issue.iid}](${created.issue.web_url})`;
      announcement += created.announcementSuffix;

      return jsonResult({
        success: true,
        issue: {
          id: created.issue.iid,
          title: created.issue.title,
          body: hasBody ? description : null,
          url: created.issue.web_url,
          label: created.label,
          workflowState: created.workflowState,
          role: created.role,
        },
        project: project.name, provider: providerType, pickup, announcement,
      });
    },
  });
}

export async function createManagedTaskIssue(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels">;
  providerType: "github" | "gitlab";
  provider: Pick<IssueProvider, "createIssue" | "addLabel" | "ensureLabel" | "editIssue">;
  workflow: WorkflowConfig;
  title: string;
  description: string;
  assignees?: string[];
  notifyTarget?: NotifyTarget | null;
  owner?: string | null;
}): Promise<CreatedManagedTask> {
  const initialState = opts.workflow.states[opts.workflow.initial];
  if (!initialState) throw new Error(`Initial workflow state "${opts.workflow.initial}" not found.`);

  const { targetKey, targetState } = resolveInitialQueueTarget(opts.workflow, initialState);
  const targetLabel = targetState.label;
  const targetRole = targetState.role ?? null;
  const issue = await opts.provider.createIssue(opts.title, opts.description, targetLabel, opts.assignees ?? []);
  const owner = opts.owner ?? null;

  const state = await writeIssueRuntimeState({
    workspaceDir: opts.workspaceDir,
    project: opts.project,
    issue: { ...issue, labels: [targetLabel], state: issue.state },
    providerType: opts.providerType,
    workflow: opts.workflow,
    workflowLabel: targetLabel,
    workflowState: targetKey,
    assignedRole: targetRole,
    assignedLevel: null,
    owner,
    notifyTarget: opts.notifyTarget ?? null,
  });

  for (const label of expectedManagedLabels(state)) {
    if (label === targetLabel) continue;
    if (label.startsWith("owner:")) {
      await opts.provider.ensureLabel(label, OWNER_LABEL_COLOR);
    }
    if (label.startsWith(NOTIFY_LABEL_PREFIX)) {
      await opts.provider.ensureLabel(label, NOTIFY_LABEL_COLOR);
    }
    await opts.provider.addLabel(issue.iid, label);
  }

  const body = replaceIssueMetadata(issue.description ?? "", {
    projectSlug: state.projectSlug,
    issueId: state.issueId,
    projectionVersion: state.projectionVersion,
  });
  const updated = await opts.provider.editIssue(issue.iid, { body });

  return {
    issue: updated,
    label: targetLabel,
    workflowState: targetKey,
    role: targetRole,
    announcementSuffix: "\nQueued for heartbeat dispatch.",
  };
}

function resolveInitialQueueTarget(
  workflow: WorkflowConfig,
  initialState: StateConfig,
): { targetKey: string; targetState: StateConfig } {
  if (initialState.type === StateType.QUEUE) {
    return { targetKey: workflow.initial, targetState: initialState };
  }

  if (initialState.type !== StateType.HOLD) {
    throw new Error(`Initial workflow state "${workflow.initial}" must be hold or queue for task_create.`);
  }

  const approve = initialState.on?.[WorkflowEvent.APPROVE];
  if (!approve) {
    throw new Error(`Initial workflow state "${workflow.initial}" has no APPROVE transition.`);
  }

  const targetKey = typeof approve === "string" ? approve : approve.target;
  const targetState = workflow.states[targetKey];
  if (!targetState) throw new Error(`Initial workflow transition target "${targetKey}" not found.`);
  if (targetState.type !== StateType.QUEUE) {
    throw new Error(`Initial workflow transition target "${targetKey}" must be a queue state.`);
  }
  return { targetKey, targetState };
}
