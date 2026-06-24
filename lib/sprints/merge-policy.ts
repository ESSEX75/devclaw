/**
 * sprints/merge-policy.ts — Sprint review/merge policy execution.
 */
import { log as auditLog } from "../audit.js";
import type { IssueProvider, PrStatus } from "../providers/provider.js";
import { loadProjectBySlug } from "../projects/index.js";
import { ReviewPolicy, type WorkflowConfig } from "../workflow/index.js";
import {
  getSprintGraph,
  listSprintGraphs,
  markSprintDone,
  markSprintFinalPrCreated,
  markSprintFinalReviewRequired,
  markStepMerged,
} from "./state.js";
import type { SprintExecutionGraph } from "./types.js";

export type SprintMergePolicy = {
  childAutoMerge: boolean;
  finalAutoMerge: boolean;
};

export type SprintMergePolicyResult = {
  childMerged: boolean;
  finalPrCreated: boolean;
  finalMerged: boolean;
  finalReviewRequired: boolean;
};

export type SprintFinalizationResult = {
  finalized: boolean;
  finalPrUrl?: string;
  reason?: "not_found" | "already_done" | "final_pr_missing" | "final_pr_not_merged";
};

export function resolveSprintMergePolicy(workflow: WorkflowConfig): SprintMergePolicy {
  const policy = workflow.reviewPolicy ?? ReviewPolicy.HUMAN;
  if (policy === ReviewPolicy.SKIP) return { childAutoMerge: true, finalAutoMerge: true };
  if (policy === ReviewPolicy.SPRINT) return { childAutoMerge: true, finalAutoMerge: false };
  return { childAutoMerge: false, finalAutoMerge: false };
}

export function canAutoMergeFinal(status: PrStatus): boolean {
  return status.url !== null && status.mergeable === true && status.checksPassed === true;
}

export async function processSprintMergePolicy(input: {
  workspaceDir: string;
  projectSlug: string;
  issueId: number;
  provider: IssueProvider;
  workflow: WorkflowConfig;
  projectBaseBranch?: string;
}): Promise<SprintMergePolicyResult> {
  const result: SprintMergePolicyResult = {
    childMerged: false,
    finalPrCreated: false,
    finalMerged: false,
    finalReviewRequired: false,
  };
  const graph = await getSprintGraphForStep(input.workspaceDir, input.projectSlug, input.issueId);
  if (!graph) return result;

  const policy = resolveSprintMergePolicy(input.workflow);
  if (!policy.childAutoMerge) return result;

  const status = await input.provider.getPrStatus(input.issueId);
  if (status.mergeable === true && status.checksPassed === true) {
    await input.provider.mergePr(input.issueId);
    await markStepMerged(input.workspaceDir, input.projectSlug, graph.sprintRootIssueId, input.issueId, {
      prUrl: status.url ?? undefined,
    });
    await auditLog(input.workspaceDir, "sprint_child_auto_merge", {
      projectSlug: input.projectSlug,
      sprintRootIssueId: graph.sprintRootIssueId,
      issueId: input.issueId,
      prUrl: status.url,
    });
    result.childMerged = true;
  } else {
    return result;
  }

  const fresh = await getSprintGraph(input.workspaceDir, input.projectSlug, graph.sprintRootIssueId);
  if (!fresh || !allChildrenMergedOrDone(fresh)) return result;

  const projectBaseBranch = input.projectBaseBranch ??
    (await loadProjectBySlug(input.workspaceDir, input.projectSlug))?.baseBranch;
  if (!projectBaseBranch) throw new Error(`Project base branch not found: ${input.projectSlug}`);

  let finalPrUrl = fresh.finalPrUrl;
  if (!finalPrUrl) {
    const pr = await input.provider.createPullRequest({
      title: `Finalize ${fresh.milestone}`,
      body: `Final sprint PR for ${fresh.milestone}.`,
      sourceBranch: fresh.sprintBranch,
      targetBranch: projectBaseBranch,
      issueId: fresh.sprintRootIssueId,
    });
    await input.provider.linkPullRequestToIssue({
      issueId: fresh.sprintRootIssueId,
      pullRequestId: pr.id,
      pullRequestUrl: pr.url,
    });
    await markSprintFinalPrCreated(input.workspaceDir, input.projectSlug, fresh.sprintRootIssueId, pr.url);
    finalPrUrl = pr.url;
    result.finalPrCreated = true;
  }

  if (!policy.finalAutoMerge) return result;

  const finalStatus = await input.provider.getPrStatus(fresh.sprintRootIssueId);
  if (!canAutoMergeFinal(finalStatus)) {
    await markSprintFinalReviewRequired(
      input.workspaceDir,
      input.projectSlug,
      fresh.sprintRootIssueId,
      "final_auto_merge_not_verifiable",
    );
    result.finalReviewRequired = true;
    return result;
  }

  await input.provider.mergePr(fresh.sprintRootIssueId);
  await finalizeMergedSprint({
    workspaceDir: input.workspaceDir,
    projectSlug: input.projectSlug,
    sprintRootIssueId: fresh.sprintRootIssueId,
    provider: input.provider,
    mergedFinalPrUrl: finalStatus.url ?? finalPrUrl,
  });
  await auditLog(input.workspaceDir, "sprint_final_auto_merge", {
    projectSlug: input.projectSlug,
    sprintRootIssueId: fresh.sprintRootIssueId,
    prUrl: finalStatus.url ?? finalPrUrl,
  });
  result.finalMerged = true;
  return result;
}

export async function finalizeMergedSprint(input: {
  workspaceDir: string;
  projectSlug: string;
  sprintRootIssueId: number;
  provider: IssueProvider;
  mergedFinalPrUrl?: string;
}): Promise<SprintFinalizationResult> {
  const graph = await getSprintGraph(input.workspaceDir, input.projectSlug, input.sprintRootIssueId);
  if (!graph) return { finalized: false, reason: "not_found" };
  if (graph.status === "done") {
    return {
      finalized: false,
      reason: "already_done",
      finalPrUrl: input.mergedFinalPrUrl ?? graph.finalPrUrl,
    };
  }

  const finalPrUrl = input.mergedFinalPrUrl ?? graph.finalPrUrl;
  if (!finalPrUrl) return { finalized: false, reason: "final_pr_missing" };

  await input.provider.closeIssue(input.sprintRootIssueId);
  const tree = await input.provider.readSprintTree({ rootIssueId: input.sprintRootIssueId });
  if (tree.milestone?.id) {
    await input.provider.closeSprintMilestone({ milestoneId: tree.milestone.id });
  }
  await markSprintDone(input.workspaceDir, input.projectSlug, input.sprintRootIssueId);
  await auditLog(input.workspaceDir, "sprint_finalize_merged", {
    projectSlug: input.projectSlug,
    sprintRootIssueId: input.sprintRootIssueId,
    prUrl: finalPrUrl,
  });
  return { finalized: true, finalPrUrl };
}

export async function reconcileMergedSprintFinalPrs(input: {
  workspaceDir: string;
  projectSlug: string;
  provider: IssueProvider;
}): Promise<SprintFinalizationResult[]> {
  const graphs = await listSprintGraphs(input.workspaceDir, input.projectSlug);
  const candidates = graphs.filter((graph) =>
    graph.status === "active" || graph.status === "final_review_required",
  );
  const results: SprintFinalizationResult[] = [];
  for (const graph of candidates) {
    if (!graph.finalPrUrl) {
      results.push({ finalized: false, reason: "final_pr_missing" });
      continue;
    }
    const status = await input.provider.getPrStatus(graph.sprintRootIssueId);
    const statusUrlMatches = !status.url || status.url === graph.finalPrUrl;
    if (status.state !== "merged" || !statusUrlMatches) {
      results.push({
        finalized: false,
        reason: "final_pr_not_merged",
        finalPrUrl: graph.finalPrUrl,
      });
      continue;
    }
    results.push(await finalizeMergedSprint({
      workspaceDir: input.workspaceDir,
      projectSlug: input.projectSlug,
      sprintRootIssueId: graph.sprintRootIssueId,
      provider: input.provider,
      mergedFinalPrUrl: status.url ?? graph.finalPrUrl,
    }));
  }
  return results;
}

async function getSprintGraphForStep(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
): Promise<SprintExecutionGraph | undefined> {
  const graphs = await listSprintGraphs(workspaceDir, projectSlug);
  return graphs.find((graph) => graph.steps.some((step) => step.issueId === issueId));
}

function allChildrenMergedOrDone(graph: SprintExecutionGraph): boolean {
  return graph.steps.every((step) => step.status === "merged" || step.status === "done");
}
