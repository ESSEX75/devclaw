import type { Issue, IssueProvider, SprintTree } from "../../providers/provider.js";
import type { Project } from "../../projects/index.js";
import {
  listSprintGraphs,
  SprintGraphStatus,
  SprintStepStatus,
  type SprintExecutionGraph,
  type SprintStep,
} from "../../sprints/index.js";

export type SprintIssueSummary = {
  id: number;
  title: string;
  state: string;
  url: string;
};

export type SprintStepStatusSummary = {
  id: number;
  title: string;
  state: SprintStepStatus;
  blockedBy: number[];
  prUrl: string | null;
  prTargetBranch: string;
  worker: string | null;
};

export type SprintStatusSummary = {
  root: SprintIssueSummary;
  milestone: string;
  sprintBranch: string;
  finalPr: string | null;
  status: SprintGraphStatus;
  progress: { merged: number; total: number };
  steps: SprintStepStatusSummary[];
};

export async function buildSprintStatusSummaries(input: {
  workspaceDir: string;
  project: Project;
  provider: IssueProvider;
}): Promise<SprintStatusSummary[]> {
  const graphs = await listSprintGraphs(input.workspaceDir, input.project.slug);
  const summaries = await Promise.all(
    graphs.map((graph) => buildSprintStatusSummary(graph, input.project, input.provider)),
  );
  return summaries.sort((a, b) => a.root.id - b.root.id);
}

async function buildSprintStatusSummary(
  graph: SprintExecutionGraph,
  project: Project,
  provider: IssueProvider,
): Promise<SprintStatusSummary> {
  const tree = await readTreeOrFallback(graph, provider);
  const root = issueSummary(tree.rootIssue, graph.sprintRootIssueId);
  const childIssues = new Map(tree.childIssues.map((issue) => [issue.iid, issue]));
  const pullRequests = new Map(tree.pullRequests.map((pr) => [pr.sourceBranch, pr]));

  const steps = graph.steps.map((step) => {
    const issue = childIssues.get(step.issueId);
    const pr = step.prUrl
      ? { url: step.prUrl }
      : pullRequests.get(step.workBranch);

    return {
      id: step.issueId,
      title: issue?.title ?? `Issue #${step.issueId}`,
      state: step.status,
      blockedBy: [...(step.blockedBy ?? [])],
      prUrl: pr?.url ?? null,
      prTargetBranch: step.prTargetBranch,
      worker: findWorkerForIssue(project, step.issueId),
    };
  });

  return {
    root,
    milestone: tree.milestone?.title ?? graph.milestone,
    sprintBranch: graph.sprintBranch,
    finalPr: graph.finalPrUrl ?? null,
    status: graph.status,
    progress: {
      merged: graph.steps.filter((step) => isMergedProgress(step)).length,
      total: graph.steps.length,
    },
    steps,
  };
}

async function readTreeOrFallback(
  graph: SprintExecutionGraph,
  provider: IssueProvider,
): Promise<SprintTree> {
  try {
    return await provider.readSprintTree({ rootIssueId: graph.sprintRootIssueId });
  } catch {
    const [rootIssue, childIssues] = await Promise.all([
      readIssueOrPlaceholder(provider, graph.sprintRootIssueId),
      Promise.all(graph.steps.map((step) => readIssueOrPlaceholder(provider, step.issueId))),
    ]);
    return {
      rootIssue,
      childIssues,
      dependencies: [],
      pullRequests: graph.steps
        .filter((step) => step.prUrl)
        .map((step) => ({
          id: String(step.issueId),
          url: step.prUrl!,
          sourceBranch: step.workBranch,
          targetBranch: step.prTargetBranch,
        })),
    };
  }
}

async function readIssueOrPlaceholder(provider: IssueProvider, issueId: number): Promise<Issue> {
  try {
    return await provider.getIssue(issueId);
  } catch {
    return {
      iid: issueId,
      title: `Issue #${issueId}`,
      description: "",
      labels: [],
      state: "unknown",
      web_url: "",
    };
  }
}

function issueSummary(issue: Issue, fallbackId: number): SprintIssueSummary {
  return {
    id: issue.iid ?? fallbackId,
    title: issue.title ?? `Issue #${fallbackId}`,
    state: issue.state ?? "unknown",
    url: issue.web_url ?? "",
  };
}

function findWorkerForIssue(project: Project, issueId: number): string | null {
  for (const [role, roleState] of Object.entries(project.workers)) {
    for (const [level, slots] of Object.entries(roleState.levels)) {
      const slot = slots.find((candidate) =>
        candidate.active && candidate.issueId === String(issueId)
      );
      if (slot) return `${role}:${level}${slot.name ? `:${slot.name}` : ""}`;
    }
  }
  return null;
}

function isMergedProgress(step: SprintStep): boolean {
  return step.status === SprintStepStatus.MERGED || step.status === SprintStepStatus.DONE;
}
