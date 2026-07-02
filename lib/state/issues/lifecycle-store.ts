/**
 * issues/lifecycle.ts — Additive writes from existing issue lifecycle paths.
 */
import type { Project } from "../../domain/projects/index.js";
import type { Issue, IssueProvider as ProviderIssueProvider } from "../../integrations/providers/provider.js";
import { ReviewPolicy, TestPolicy, type WorkflowConfig } from "../../domain/workflow/types.js";
import {
  findStateKeyByLabel,
  getCurrentStateLabel,
} from "../../domain/workflow/queries.js";
import {
  detectOwner,
  NOTIFY_LABEL_PREFIX,
} from "../../domain/workflow/labels.js";
import { updateIssueStateStore } from "./store.js";
import type {
  ActiveIssueWorker,
  IssueIntegrityStatus,
  IssueProvider as IssueProviderKind,
  IssueRuntimeState,
  NotifyTarget,
} from "../../domain/issues/types.js";

export type IssueStateWriteInput = {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels">;
  issue: Pick<Issue, "iid" | "labels" | "state">;
  providerType: IssueProviderKind;
  workflow: WorkflowConfig;
  workflowLabel?: string;
  workflowState?: string;
  assignedRole?: string | null;
  assignedLevel?: string | null;
  owner?: string | null;
  notifyTarget?: NotifyTarget | null;
  reviewPolicy?: ReviewPolicy | null;
  testPolicy?: TestPolicy | null;
  activeWorker?: ActiveIssueWorker | null;
  integrityStatus?: IssueIntegrityStatus;
  closedAt?: string | null;
  archivedAt?: string | null;
};

type RoleLevel = {
  role: string;
  level: string;
};

export function detectNotifyTarget(
  labels: string[],
  channels: Pick<Project, "channels">["channels"],
): NotifyTarget | null {
  const notifyLabel = labels.find((label) => label.startsWith(NOTIFY_LABEL_PREFIX));
  if (!notifyLabel) return null;
  const value = notifyLabel.slice(NOTIFY_LABEL_PREFIX.length);
  const colonIdx = value.indexOf(":");
  if (colonIdx === -1) {
    const channel = channels.find((ch) => ch.channelId === value);
    return channel ? { channel: channel.channel, name: channel.name } : null;
  }
  return {
    channel: value.slice(0, colonIdx),
    name: value.slice(colonIdx + 1),
  };
}

export function detectRoleLevel(labels: string[]): RoleLevel | null {
  for (const label of labels) {
    const parts = label.split(":");
    if (parts.length !== 2) continue;
    const [role, level] = parts;
    if (!role || !level) continue;
    if (role === "review" || role === "test" || role === "notify" || role === "owner" || role === "devclaw") continue;
    return { role, level };
  }
  return null;
}

function detectRouting(labels: string[], prefix: "review"): ReviewPolicy | null;
function detectRouting(labels: string[], prefix: "test"): TestPolicy | null;
function detectRouting(labels: string[], prefix: "review" | "test"): ReviewPolicy | TestPolicy | null {
  const label = labels.find((candidate) => candidate.startsWith(`${prefix}:`));
  const value = label ? label.slice(prefix.length + 1) : null;
  if (prefix === "review") {
    return value === ReviewPolicy.HUMAN || value === ReviewPolicy.AGENT || value === ReviewPolicy.SKIP ? value : null;
  }
  return value === TestPolicy.AGENT || value === TestPolicy.SKIP ? value : null;
}

export async function writeIssueRuntimeState(input: IssueStateWriteInput): Promise<IssueRuntimeState> {
  const labels = input.issue.labels;
  const detectedWorkflowLabel = input.workflowLabel ?? getCurrentStateLabel(labels, input.workflow);
  if (!detectedWorkflowLabel) {
    throw new Error(`Issue #${input.issue.iid} has no recognized workflow label for issue state write.`);
  }
  const detectedRoleLevel = detectRoleLevel(labels);
  const workflowState = input.workflowState
    ?? findStateKeyByLabel(input.workflow, detectedWorkflowLabel)
    ?? detectedWorkflowLabel;
  const now = new Date().toISOString();

  let written!: IssueRuntimeState;
  await updateIssueStateStore(input.workspaceDir, input.project.slug, (store) => {
    const previous = store.issues[String(input.issue.iid)];
    written = {
      projectSlug: input.project.slug,
      issueId: input.issue.iid,
      provider: input.providerType,
      managed: true,
      workflowState,
      workflowLabel: detectedWorkflowLabel,
      assignedRole: input.assignedRole !== undefined ? input.assignedRole : detectedRoleLevel?.role ?? previous?.assignedRole ?? null,
      assignedLevel: input.assignedLevel !== undefined ? input.assignedLevel : detectedRoleLevel?.level ?? previous?.assignedLevel ?? null,
      owner: input.owner !== undefined ? input.owner : detectOwner(labels) ?? previous?.owner ?? null,
      reviewPolicy: input.reviewPolicy !== undefined ? input.reviewPolicy : detectRouting(labels, "review") ?? previous?.reviewPolicy ?? null,
      testPolicy: input.testPolicy !== undefined ? input.testPolicy : detectRouting(labels, "test") ?? previous?.testPolicy ?? null,
      notifyTarget: input.notifyTarget !== undefined ? input.notifyTarget : detectNotifyTarget(labels, input.project.channels) ?? previous?.notifyTarget ?? null,
      branchContract: previous?.branchContract ?? null,
      activeWorker: input.activeWorker !== undefined ? input.activeWorker : previous?.activeWorker ?? null,
      integrityStatus: input.integrityStatus ?? previous?.integrityStatus ?? "ok",
      integrityErrors: previous?.integrityErrors ?? [],
      projectionVersion: previous?.projectionVersion ?? 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      closedAt: input.closedAt !== undefined ? input.closedAt : previous?.closedAt ?? null,
      archivedAt: input.archivedAt !== undefined ? input.archivedAt : previous?.archivedAt ?? null,
    };
    store.issues[String(input.issue.iid)] = written;
  });
  return written;
}

export function providerKindFromProject(project: Pick<Project, "provider">): IssueProviderKind {
  return project.provider === "github" ? "github" : "gitlab";
}

export type { ProviderIssueProvider };
