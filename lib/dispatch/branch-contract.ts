/**
 * dispatch/branch-contract.ts — Resolve exact branch instructions for workers.
 */
import type { Project } from "../projects/index.js";
import { listSprintGraphs } from "../sprints/index.js";
import { TaskMode, type WorkflowConfig } from "../workflow/index.js";

export type DispatchBranchContract = {
  mode: "issue" | "sprint";
  baseBranch: string;
  workBranch: string;
  prTargetBranch: string;
  sprintRootIssueId?: number;
};

export async function resolveDispatchBranchContract(input: {
  workspaceDir: string;
  project: Project;
  issueId: number;
  issueTitle: string;
  workflow: WorkflowConfig;
}): Promise<DispatchBranchContract> {
  if (input.workflow.taskMode === TaskMode.SPRINT) {
    const graphs = await listSprintGraphs(input.workspaceDir, input.project.slug);
    for (const graph of graphs) {
      const step = graph.steps.find((candidate) => candidate.issueId === input.issueId);
      if (!step) continue;
      if (!graph.sprintBranch) {
        throw new Error(`Sprint graph ${graph.projectSlug}:${graph.sprintRootIssueId} is missing sprintBranch.`);
      }
      return {
        mode: "sprint",
        baseBranch: input.project.baseBranch,
        workBranch: step.workBranch,
        prTargetBranch: graph.sprintBranch,
        sprintRootIssueId: graph.sprintRootIssueId,
      };
    }
  }

  return {
    mode: "issue",
    baseBranch: input.project.baseBranch,
    workBranch: `issue/${input.issueId}-${slugPart(input.issueTitle)}`,
    prTargetBranch: input.project.baseBranch,
  };
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "work";
}
