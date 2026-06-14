/**
 * sprint_create — Create a DevClaw sprint structure.
 *
 * Sprint runtime state is stored in the local execution graph. Provider
 * milestones, issues, labels, comments, and metadata are projections.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../../context.js";
import { log as auditLog } from "../../audit.js";
import { loadConfig } from "../../config/index.js";
import { readProjects, getProject, type Project } from "../../projects/index.js";
import { createProvider } from "../../providers/index.js";
import type { IssueProvider, Issue } from "../../providers/provider.js";
import {
  appendManagedSprintMetadata,
  createSprintGraph,
  expectedManagedLabelsForIssue,
  SprintGraphStatus,
  SprintStepStatus,
  type SprintExecutionGraph,
} from "../../sprints/index.js";
import {
  assertSprintReady,
  checkSprintReinitReadiness,
  sprintModeEnabled,
} from "../../setup/sprint-readiness.js";
import { requireWorkspaceDir } from "../helpers.js";

export type SprintCreateStepInput = {
  id: string;
  title: string;
  body?: string;
  acceptanceCriteria?: string[];
  dependsOn?: string[];
  labels?: string[];
};

export type SprintCreateInput = {
  projectSlug: string;
  title: string;
  description?: string;
  baseBranch?: string;
  assignees?: string[];
  steps: SprintCreateStepInput[];
  sprintBlockedBy?: string[];
};

type ResolvedSprintStep = SprintCreateStepInput & {
  order: number;
  dependsOn: string[];
};

export function createSprintCreateTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "sprint_create",
    label: "Sprint Create",
    description:
      "Create a sprint milestone/root issue/child issues/sprint branch and local execution graph. " +
      "Use task_create for standalone issues.",
    parameters: {
      type: "object",
      required: ["projectSlug", "title", "steps"],
      properties: {
        projectSlug: {
          type: "string",
          description: "Registered project slug. This is not a channel ID.",
        },
        title: {
          type: "string",
          description: "Sprint title / delivery scope.",
        },
        description: {
          type: "string",
          description: "Sprint root issue body / delivery context.",
        },
        baseBranch: {
          type: "string",
          description: "Optional base branch override. Defaults to project.baseBranch.",
        },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: "GitHub/GitLab usernames assigned to root and child issues.",
        },
        steps: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["id", "title"],
            properties: {
              id: { type: "string", description: "Stable step id, unique inside the sprint." },
              title: { type: "string", description: "Child issue title." },
              body: { type: "string", description: "Child issue body." },
              acceptanceCriteria: {
                type: "array",
                items: { type: "string" },
                description: "Acceptance criteria rendered into the child issue body.",
              },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description:
                  "Explicit dependency step ids. Omit for default linear dependency on the previous step.",
              },
              labels: {
                type: "array",
                items: { type: "string" },
                description: "Additional labels projected onto the child issue.",
              },
            },
          },
        },
        sprintBlockedBy: {
          type: "array",
          items: { type: "string" },
          description: "Sprint root issue ids that block this sprint.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const input = validateSprintCreateInput(params);
      const data = await readProjects(workspaceDir);
      const project = getProject(data, input.projectSlug);
      if (!project || project.slug !== input.projectSlug) {
        throw new Error(`No project found for slug "${input.projectSlug}".`);
      }

      const resolvedConfig = await loadConfig(workspaceDir, project.name);
      if (!sprintModeEnabled(resolvedConfig)) {
        throw new Error(`Project "${project.slug}" must set workflow.taskMode: sprint before sprint_create can run.`);
      }

      const { provider, type: providerType } = await createProvider({
        repo: project.repo,
        provider: project.provider,
        runCommand: ctx.runCommand,
      });

      const baseBranch = input.baseBranch ?? project.baseBranch;
      const readiness = await checkSprintReinitReadiness({
        provider,
        project: { baseBranch },
        config: resolvedConfig,
      });
      assertSprintReady(readiness);

      const result = await createSprintStructure({
        workspaceDir,
        provider,
        project,
        input,
        baseBranch,
      });

      await auditLog(workspaceDir, "sprint_create", {
        projectSlug: project.slug,
        provider: providerType,
        sprintRootIssueId: result.rootIssue.iid,
        milestoneId: result.milestone.id,
        sprintBranch: result.graph.sprintBranch,
        stepIssueIds: result.graph.steps.map((step) => step.issueId),
      });

      return jsonResult({
        success: true,
        project: { slug: project.slug, name: project.name },
        provider: providerType,
        sprint: {
          rootIssue: {
            id: result.rootIssue.iid,
            title: result.rootIssue.title,
            url: result.rootIssue.web_url,
          },
          milestone: result.milestone,
          sprintBranch: result.graph.sprintBranch,
          baseBranch,
          sprintBlockedBy: result.graph.sprintBlockedBy,
          steps: result.graph.steps,
        },
      });
    },
  });
}

export async function createSprintStructure(args: {
  workspaceDir: string;
  provider: IssueProvider;
  project: Project;
  input: SprintCreateInput;
  baseBranch: string;
}): Promise<{
  milestone: Awaited<ReturnType<IssueProvider["createSprintMilestone"]>>;
  rootIssue: Issue;
  childIssues: Issue[];
  graph: SprintExecutionGraph;
}> {
  const steps = resolveSprintSteps(args.input.steps);
  const milestoneTitle = toSprintMilestoneTitle(args.input.title);
  const sprintBranch = `sprint/${slugPart(milestoneTitle)}`;
  const sprintBlockedBy = parseIssueIds(args.input.sprintBlockedBy ?? []);
  const assignees = args.input.assignees ?? [];

  const milestone = await args.provider.createSprintMilestone({
    title: milestoneTitle,
    description: args.input.description,
  });
  const sprintLabel = `sprint:${milestone.title}`;
  const rootIssue = await args.provider.createSprintRoot({
    title: args.input.title,
    body: renderRootBody({
      title: args.input.title,
      description: args.input.description,
      milestone: milestone.title,
      sprintBranch,
      steps,
      sprintBlockedBy,
    }),
    milestoneId: milestone.id,
    labels: ["devclaw:sprint", "sprint:root", sprintLabel],
    assignees,
  });
  await args.provider.createSprintBranch({
    branch: sprintBranch,
    fromBranch: args.baseBranch,
  });

  const childIssues: Issue[] = [];
  const issueIdByStepId = new Map<string, number>();
  for (const step of steps) {
    const issue = await args.provider.createChildIssue({
      title: step.title,
      body: renderChildBody(step, rootIssue.iid, sprintBranch),
      milestoneId: milestone.id,
      labels: [...new Set(["devclaw:sprint", "sprint:child", sprintLabel, ...(step.labels ?? [])])],
      assignees,
    });
    childIssues.push(issue);
    issueIdByStepId.set(step.id, issue.iid);
    await args.provider.linkChildIssue({
      rootIssueId: rootIssue.iid,
      childIssueId: issue.iid,
    });
  }

  const graph = await createSprintGraph(args.workspaceDir, {
    projectSlug: args.project.slug,
    sprintRootIssueId: rootIssue.iid,
    milestone: milestone.title,
    sprintBranch,
    status: SprintGraphStatus.ACTIVE,
    sprintBlockedBy,
    steps: steps.map((step, index) => {
      const issueId = issueIdByStepId.get(step.id);
      if (!issueId) throw new Error(`Missing issue id for step "${step.id}".`);
      const blockedBy = step.dependsOn.map((id) => issueIdByStepId.get(id)).filter((id): id is number => id !== undefined);
      return {
        issueId,
        order: index + 1,
        workBranch: `step/${issueId}-${slugPart(step.id)}`,
        prTargetBranch: sprintBranch,
        blockedBy,
        status: blockedBy.length > 0 || sprintBlockedBy.length > 0
          ? SprintStepStatus.BLOCKED
          : SprintStepStatus.READY,
      };
    }),
  });

  for (const issueId of [rootIssue.iid, ...graph.steps.map((step) => step.issueId)]) {
    for (const label of expectedManagedLabelsForIssue(graph, issueId)) {
      await args.provider.addLabel(issueId, label);
    }
  }

  await args.provider.editIssue(rootIssue.iid, {
    body: appendManagedSprintMetadata(renderRootBody({
      title: args.input.title,
      description: args.input.description,
      milestone: milestone.title,
      sprintBranch,
      steps,
      sprintBlockedBy,
    }), graph),
  });

  return { milestone, rootIssue, childIssues, graph };
}

export function validateSprintCreateInput(params: Record<string, unknown>): SprintCreateInput {
  const projectSlug = requireNonEmptyString(params.projectSlug, "projectSlug");
  const title = requireNonEmptyString(params.title, "title");
  const stepsValue = params.steps;
  if (!Array.isArray(stepsValue) || stepsValue.length === 0) {
    throw new Error("steps must be a non-empty array.");
  }

  const steps: SprintCreateStepInput[] = stepsValue.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`steps[${index}] must be an object.`);
    const record = value as Record<string, unknown>;
    return {
      id: requireNonEmptyString(record.id, `steps[${index}].id`),
      title: requireNonEmptyString(record.title, `steps[${index}].title`),
      body: typeof record.body === "string" ? record.body : undefined,
      acceptanceCriteria: optionalStringArray(record.acceptanceCriteria, `steps[${index}].acceptanceCriteria`),
      dependsOn: optionalStringArray(record.dependsOn, `steps[${index}].dependsOn`),
      labels: optionalStringArray(record.labels, `steps[${index}].labels`),
    };
  });

  resolveSprintSteps(steps);
  const sprintBlockedBy = optionalStringArray(params.sprintBlockedBy, "sprintBlockedBy");
  parseIssueIds(sprintBlockedBy ?? []);

  return {
    projectSlug,
    title,
    description: typeof params.description === "string" ? params.description : undefined,
    baseBranch: typeof params.baseBranch === "string" && params.baseBranch.trim() ? params.baseBranch.trim() : undefined,
    assignees: optionalStringArray(params.assignees, "assignees"),
    steps,
    sprintBlockedBy,
  };
}

export function resolveSprintSteps(steps: SprintCreateStepInput[]): ResolvedSprintStep[] {
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) throw new Error(`Duplicate sprint step id "${step.id}".`);
    seen.add(step.id);
  }

  return steps.map((step, index) => {
    const dependsOn = step.dependsOn !== undefined
      ? step.dependsOn
      : index === 0 ? [] : [steps[index - 1]!.id];
    for (const dependency of dependsOn) {
      if (!seen.has(dependency)) {
        throw new Error(`Step "${step.id}" depends on unknown step "${dependency}".`);
      }
      if (dependency === step.id) {
        throw new Error(`Step "${step.id}" cannot depend on itself.`);
      }
    }
    return { ...step, order: index + 1, dependsOn };
  });
}

function renderRootBody(input: {
  title: string;
  description?: string;
  milestone: string;
  sprintBranch: string;
  sprintBlockedBy: number[];
  steps: ResolvedSprintStep[];
}): string {
  const lines = [
    input.description?.trim() || `Sprint scope: ${input.title}`,
    "",
    "## DevClaw sprint",
    "",
    `- Milestone: ${input.milestone}`,
    `- Sprint branch: ${input.sprintBranch}`,
    `- Blocked by sprint roots: ${input.sprintBlockedBy.length ? input.sprintBlockedBy.map((id) => `#${id}`).join(", ") : "none"}`,
    "",
    "## Steps",
    ...input.steps.map((step) => `- ${step.order}. ${step.title} (${step.id})`),
  ];
  return lines.join("\n");
}

function renderChildBody(step: ResolvedSprintStep, rootIssueId: number, sprintBranch: string): string {
  const lines = [
    step.body?.trim() || `Sprint step: ${step.title}`,
    "",
    "## DevClaw sprint step",
    "",
    `- Sprint root: #${rootIssueId}`,
    `- Step id: ${step.id}`,
    `- PR target branch: ${sprintBranch}`,
    `- Depends on: ${step.dependsOn.length ? step.dependsOn.join(", ") : "none"}`,
  ];
  if (step.acceptanceCriteria?.length) {
    lines.push("", "## Acceptance criteria");
    lines.push(...step.acceptanceCriteria.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings.`);
  return value.map((item, index) => requireNonEmptyString(item, `${field}[${index}]`));
}

function parseIssueIds(values: string[]): number[] {
  return values.map((value) => {
    const numeric = value.trim().replace(/^#/, "");
    const parsed = Number(numeric);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid issue id "${value}" in sprintBlockedBy.`);
    }
    return parsed;
  });
}

function toSprintMilestoneTitle(title: string): string {
  return `sprint-${slugPart(title)}`;
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "sprint";
}
