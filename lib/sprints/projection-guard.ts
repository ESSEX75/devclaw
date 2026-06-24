/**
 * sprints/projection-guard.ts — Managed provider projection guard.
 *
 * Provider issues are projections. This module restores managed provider fields
 * from the local execution graph and marks tampered metadata as integrity_error.
 */
import { log as auditLog } from "../audit.js";
import type { IssueProvider } from "../providers/provider.js";
import { markSprintIntegrityError, markSprintRepaired } from "./state.js";
import { SprintStepStatus, type SprintExecutionGraph } from "./types.js";

const MANAGED_LABEL_PREFIXES = ["devclaw:", "sprint:", "step:", "blocked:"] as const;
const METADATA_START = "<!-- devclaw:sprint-metadata ";
const METADATA_END = " -->";
const METADATA_RE = /<!-- devclaw:sprint-metadata ([\s\S]*?) -->/;

export type ProjectionLabelAction = "added" | "removed";

export type ProjectionLabelChange = {
  workspaceDir: string;
  provider: IssueProvider;
  graph: SprintExecutionGraph;
  issueId: number;
  label: string;
  action: ProjectionLabelAction;
};

export type ProjectionBodyChange = {
  workspaceDir: string;
  graph: SprintExecutionGraph;
  issueId: number;
  previousBody: string;
  nextBody: string;
};

export type RepairSprintProjectionInput = {
  workspaceDir: string;
  provider: IssueProvider;
  graph: SprintExecutionGraph;
};

export function isManagedProjectionLabel(label: string): boolean {
  return MANAGED_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix));
}

export function sprintProjectionLabel(graph: SprintExecutionGraph): string {
  return `sprint:${graph.milestone}`;
}

export function expectedManagedLabelsForIssue(
  graph: SprintExecutionGraph,
  issueId: number,
): string[] {
  const sprintLabel = sprintProjectionLabel(graph);
  if (issueId === graph.sprintRootIssueId) {
    return ["devclaw:sprint", "sprint:root", sprintLabel];
  }

  const step = graph.steps.find((candidate) => candidate.issueId === issueId);
  if (!step) return [];

  const labels = ["devclaw:sprint", "sprint:child", sprintLabel, `step:${step.order}`];
  if (graph.reviewPolicy === "sprint") labels.push("review:sprint");
  if (step.status === SprintStepStatus.BLOCKED || (step.blockedBy ?? []).length > 0 || graph.sprintBlockedBy.length > 0) {
    labels.push("blocked:step");
  }
  return [...new Set(labels)];
}

export async function handleProjectionLabelChange(input: ProjectionLabelChange): Promise<{
  action: "ignored" | "restored";
  restored: string[];
}> {
  if (!isManagedProjectionLabel(input.label) && !isManagedSprintReviewLabel(input.graph, input.label)) {
    return { action: "ignored", restored: [] };
  }

  const expected = expectedManagedLabelsForIssue(input.graph, input.issueId);
  const shouldExist = expected.includes(input.label);

  if (input.action === "removed" && shouldExist) {
    await input.provider.addLabel(input.issueId, input.label);
    await auditLog(input.workspaceDir, "sprint_projection_label_restored", {
      projectSlug: input.graph.projectSlug,
      sprintRootIssueId: input.graph.sprintRootIssueId,
      issueId: input.issueId,
      label: input.label,
      reason: "managed_label_removed",
    });
    return { action: "restored", restored: [input.label] };
  }

  if (input.action === "added" && !shouldExist) {
    await input.provider.removeLabels(input.issueId, [input.label]);
    await auditLog(input.workspaceDir, "sprint_projection_label_restored", {
      projectSlug: input.graph.projectSlug,
      sprintRootIssueId: input.graph.sprintRootIssueId,
      issueId: input.issueId,
      label: input.label,
      reason: "unexpected_managed_label_added",
    });
    return { action: "restored", restored: [input.label] };
  }

  return { action: "ignored", restored: [] };
}

function isManagedSprintReviewLabel(graph: SprintExecutionGraph, label: string): boolean {
  return graph.reviewPolicy === "sprint" && label.startsWith("review:");
}

export async function handleProjectionBodyChange(input: ProjectionBodyChange): Promise<{
  action: "ignored" | "integrity_error";
  integrityErrors: string[];
}> {
  const previousMetadata = extractManagedSprintMetadataBlock(input.previousBody);
  const nextMetadata = extractManagedSprintMetadataBlock(input.nextBody);
  if (previousMetadata === nextMetadata) {
    return { action: "ignored", integrityErrors: [] };
  }

  const integrityErrors = [`managed metadata changed on issue #${input.issueId}`];
  await markSprintIntegrityError(
    input.workspaceDir,
    input.graph.projectSlug,
    input.graph.sprintRootIssueId,
    integrityErrors,
  );
  return { action: "integrity_error", integrityErrors };
}

export async function repairSprintProjectionFromLocalState(input: RepairSprintProjectionInput): Promise<{
  repaired: string[];
}> {
  const repaired: string[] = [];
  for (const issueId of [input.graph.sprintRootIssueId, ...input.graph.steps.map((step) => step.issueId)]) {
    const issue = await input.provider.getIssue(issueId);
    for (const label of expectedManagedLabelsForIssue(input.graph, issueId)) {
      await input.provider.addLabel(issueId, label);
      repaired.push(`label:${issueId}:${label}`);
    }
    const expected = new Set(expectedManagedLabelsForIssue(input.graph, issueId));
    const staleManagedLabels = issue.labels.filter((label) =>
      (isManagedProjectionLabel(label) || isManagedSprintReviewLabel(input.graph, label)) &&
      !expected.has(label)
    );
    if (staleManagedLabels.length > 0) {
      await input.provider.removeLabels(issueId, staleManagedLabels);
      repaired.push(...staleManagedLabels.map((label) => `label-removed:${issueId}:${label}`));
    }
  }

  const rootIssue = await input.provider.getIssue(input.graph.sprintRootIssueId);
  await input.provider.editIssue(input.graph.sprintRootIssueId, {
    body: appendManagedSprintMetadata(rootIssue.description, input.graph),
  });
  repaired.push(`metadata:${input.graph.sprintRootIssueId}`);

  for (const step of input.graph.steps) {
    for (const blockingIssueId of step.blockedBy ?? []) {
      const blockingComment = `DevClaw sprint projection: #${blockingIssueId} blocks #${step.issueId}`;
      const blockedComment = `DevClaw sprint projection: blocked by #${blockingIssueId}`;
      if (!await hasComment(input.provider, blockingIssueId, blockingComment)) {
        await input.provider.addComment(blockingIssueId, blockingComment);
        repaired.push(`dependency-comment:${blockingIssueId}->${step.issueId}`);
      }
      if (!await hasComment(input.provider, step.issueId, blockedComment)) {
        await input.provider.addComment(step.issueId, blockedComment);
        repaired.push(`dependency-comment:${step.issueId}:blocked-by:${blockingIssueId}`);
      }
    }
  }

  await markSprintRepaired(
    input.workspaceDir,
    input.graph.projectSlug,
    input.graph.sprintRootIssueId,
    repaired,
  );
  await auditLog(input.workspaceDir, "sprint_projection_repair", {
    projectSlug: input.graph.projectSlug,
    sprintRootIssueId: input.graph.sprintRootIssueId,
    source: "local-state",
    repaired,
  });
  return { repaired };
}

export function renderManagedSprintMetadataBlock(graph: SprintExecutionGraph): string {
  return `${METADATA_START}${JSON.stringify(managedSprintMetadata(graph))}${METADATA_END}`;
}

export function appendManagedSprintMetadata(body: string, graph: SprintExecutionGraph): string {
  const metadata = renderManagedSprintMetadataBlock(graph);
  if (METADATA_RE.test(body)) return body.replace(METADATA_RE, metadata);
  return `${body.trimEnd()}\n\n${metadata}`;
}

export function extractManagedSprintMetadataBlock(body: string): string | null {
  return body.match(METADATA_RE)?.[1] ?? null;
}

function managedSprintMetadata(graph: SprintExecutionGraph): Record<string, unknown> {
  return {
    projectSlug: graph.projectSlug,
    sprintRootIssueId: graph.sprintRootIssueId,
    milestone: graph.milestone,
    sprintBranch: graph.sprintBranch,
    reviewPolicy: graph.reviewPolicy,
    sprintBlockedBy: graph.sprintBlockedBy,
    steps: graph.steps.map((step) => ({
      issueId: step.issueId,
      order: step.order,
      workBranch: step.workBranch,
      prTargetBranch: step.prTargetBranch,
      blockedBy: step.blockedBy ?? [],
    })),
  };
}

async function hasComment(
  provider: Pick<RepairSprintProjectionInput["provider"], "listComments">,
  issueId: number,
  body: string,
): Promise<boolean> {
  try {
    const comments = await provider.listComments(issueId);
    return comments.some((comment) => comment.body.includes(body));
  } catch {
    return false;
  }
}
