import {
  type IssueProviderType,
  NOTIFY_LABEL_COLOR,
  NOTIFY_LABEL_PREFIX,
  type NotifyTarget,
  OWNER_LABEL_COLOR,
  type Project,
  REVIEW_POLICY,
  STATE_TYPE,
  type StateConfig,
  TEST_POLICY,
  WORKFLOW_EVENT,
  type WorkflowConfig,
  type WorkflowStateKey,
} from "../../domain/index.js";
import type { IssueWriter, LabelProjector } from "../../integrations/providers/capabilities.js";
import type { Issue } from "../../integrations/providers/provider.js";
import { expectedManagedLabels, replaceIssueMetadata } from "../../projection/index.js";
import { writeIssueRuntimeState } from "../../state/issues/index.js";

export type CreatedManagedTask = {
  issue: Issue;
  label: string;
  workflowState: string;
  role: string | null;
  announcementSuffix: string;
};

export async function createManagedTaskIssue(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels">;
  providerType: IssueProviderType;
  provider: Pick<IssueWriter, "createIssue" | "editIssue"> & Pick<LabelProjector, "addLabel" | "ensureLabel">;
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
    reviewPolicy: opts.workflow.reviewPolicy ?? REVIEW_POLICY.HUMAN,
    testPolicy: opts.workflow.testPolicy ?? TEST_POLICY.SKIP,
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
): { targetKey: WorkflowStateKey; targetState: StateConfig } {
  if (initialState.type === STATE_TYPE.QUEUE) {
    return { targetKey: workflow.initial, targetState: initialState };
  }

  if (initialState.type !== STATE_TYPE.HOLD) {
    throw new Error(`Initial workflow state "${workflow.initial}" must be hold or queue for task_create.`);
  }

  const approve = initialState.on?.[WORKFLOW_EVENT.APPROVE];

  if (!approve) {
    throw new Error(`Initial workflow state "${workflow.initial}" has no APPROVE transition.`);
  }

  const targetKey = typeof approve === "string" ? approve : approve.target;
  const targetState = workflow.states[targetKey];

  if (!targetState) throw new Error(`Initial workflow transition target "${targetKey}" not found.`);
  if (targetState.type !== STATE_TYPE.QUEUE) {
    throw new Error(`Initial workflow transition target "${targetKey}" must be a queue state.`);
  }

  return { targetKey, targetState };
}
