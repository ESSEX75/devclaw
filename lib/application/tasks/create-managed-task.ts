import {
  type IssueProviderId,
  type NotifyTarget,
  type Project,
  REVIEW_POLICY,
  STATE_TYPE,
  TEST_POLICY,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { IssueReader, IssueWriter, LabelProjector } from "../../integrations/providers/capabilities.js";
import type { Issue } from "../../integrations/providers/provider.js";
import { replaceIssueMetadata } from "../../projection/index.js";
import { writeIssueRuntimeState } from "../../state/issues/index.js";
import { reconcileManagedLabels } from "../projection/index.js";

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
  providerType: IssueProviderId;
  provider: Pick<IssueReader, "getIssue">
    & Pick<IssueWriter, "createIssue" | "editIssue">
    & Pick<LabelProjector, "addLabel" | "ensureLabel" | "removeLabels">;
  workflow: WorkflowConfig;
  title: string;
  description: string;
  assignees?: string[];
  notifyTarget?: NotifyTarget | null;
  owner?: string | null;
}): Promise<CreatedManagedTask> {
  const initialState = opts.workflow.states[opts.workflow.initial];

  if (!initialState) throw new Error(`Initial workflow state "${opts.workflow.initial}" not found.`);

  if (initialState.type !== STATE_TYPE.HOLD && initialState.type !== STATE_TYPE.QUEUE) {
    throw new Error(`Initial workflow state "${opts.workflow.initial}" must be hold or queue for task_create.`);
  }

  const initialLabel = initialState.label;
  const initialRole = initialState.type === STATE_TYPE.QUEUE ? initialState.role : null;
  const issue = await opts.provider.createIssue(opts.title, opts.description, initialLabel, opts.assignees ?? []);
  const owner = opts.owner ?? null;

  const state = await writeIssueRuntimeState({
    workspaceDir: opts.workspaceDir,
    project: opts.project,
    issue: { ...issue, labels: [initialLabel], state: issue.state },
    providerType: opts.providerType,
    workflow: opts.workflow,
    workflowLabel: initialLabel,
    workflowState: opts.workflow.initial,
    assignedRole: initialRole,
    assignedLevel: null,
    owner,
    notifyTarget: opts.notifyTarget ?? null,
    reviewPolicy: opts.workflow.reviewPolicy ?? REVIEW_POLICY.HUMAN,
    testPolicy: opts.workflow.testPolicy ?? TEST_POLICY.SKIP,
  });

  await reconcileManagedLabels({
    workspaceDir: opts.workspaceDir,
    projectSlug: opts.project.slug,
    issueId: issue.iid,
    workflow: opts.workflow,
    provider: opts.provider,
    owner: "task_create",
  });

  const body = replaceIssueMetadata(issue.description ?? "", {
    projectSlug: state.projectSlug,
    issueId: state.issueId,
    projectionVersion: state.projectionVersion,
  });
  const updated = await opts.provider.editIssue(issue.iid, { body });

  return {
    issue: updated,
    label: initialLabel,
    workflowState: opts.workflow.initial,
    role: initialRole,
    announcementSuffix: initialState.type === STATE_TYPE.QUEUE
      ? "\nQueued for heartbeat dispatch."
      : "\nWaiting in the initial hold state. Use task_start when the task is ready for dispatch.",
  };
}
