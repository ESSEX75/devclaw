/**
 * task_list — Browse issues by workflow state.
 *
 * Lists issues grouped by state label with optional filtering by state type,
 * specific label, or text search. Supports terminal (closed) issues.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../../context.js";
import { log as auditLog } from "../../audit.js";
import { requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";
import { loadConfig } from "../../config/index.js";
import { StateType, findStateByLabel } from "../../workflow/index.js";
import { loadProjectionViewContext, summarizeTaskIssue, type TaskIssueSummary } from "./projection-view.js";
import { readIssueStateStore, type IssueRuntimeState } from "../../issues/index.js";

export function createTaskListTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_list",
    label: "Task List",
    description: `Browse issues for a project by workflow state. Shows issues grouped by state label. Use \`tasks_status\` for a quick issue dashboard, this tool for filtered browsing.`,
    parameters: {
      type: "object",
      required: ["channelId"],
      properties: {
        channelId: {
          type: "string",
          description: "YOUR chat/group ID — the numeric ID of the chat you are in right now (e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
        stateType: {
          type: "string",
          enum: ["queue", "active", "hold", "terminal", "all"],
          description: "Filter by state type. Defaults to all non-terminal states.",
        },
        label: {
          type: "string",
          description: "Filter by specific state label (e.g. 'Planning', 'Done'). Overrides stateType.",
        },
        search: {
          type: "string",
          description: "Text search in issue titles (case-insensitive).",
        },
        limit: {
          type: "number",
          description: "Max issues per state. Defaults to 20.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);
      const stateType = params.stateType as string | undefined;
      const label = params.label as string | undefined;
      const search = params.search as string | undefined;
      const limit = (params.limit as number) ?? 20;

      const { project } = await resolveProject(workspaceDir, channelId);
      const { provider } = await resolveProvider(project, ctx.runCommand);
      const projectConfig = await loadConfig(workspaceDir, project.name);
      const workflow = projectConfig.workflow;
      const projectionCtx = await loadProjectionViewContext({
        workspaceDir,
        projectSlug: project.slug,
        workflow,
        roles: Object.keys(projectConfig.roles),
      });
      const store = await readIssueStateStore(workspaceDir, project.slug);
      const localStates = Object.values(store.issues)
        .filter((state) => state.managed && state.archivedAt == null);

      // Determine which labels to fetch
      type FetchEntry = { label: string; type: string; role?: string; issueState: "open" | "closed" | "all" };
      const labelsToFetch: FetchEntry[] = [];

      if (label) {
        const stateConfig = findStateByLabel(workflow, label);
        if (!stateConfig) throw new Error(`Unknown state label "${label}". Check workflow_guide for valid states.`);
        labelsToFetch.push({
          label: stateConfig.label,
          type: stateConfig.type,
          role: stateConfig.role,
          issueState: stateConfig.type === StateType.TERMINAL ? "closed" : "open",
        });
      } else {
        const includeTerminal = stateType === "terminal" || stateType === "all";
        for (const state of Object.values(workflow.states)) {
          if (state.type === StateType.TERMINAL && !includeTerminal) continue;
          if (stateType && stateType !== "all" && state.type !== stateType) continue;
          labelsToFetch.push({
            label: state.label,
            type: state.type,
            role: state.role,
            issueState: state.type === StateType.TERMINAL ? "closed" : "open",
          });
        }
      }

      // Fetch and filter
      const searchLower = search?.toLowerCase();
      const results: Array<{
        label: string;
        type: string;
        role?: string;
        issues: TaskIssueSummary[];
        total: number;
      }> = [];

      for (const entry of labelsToFetch) {
        let states = localStates.filter((state) => state.workflowLabel === entry.label);

        if (searchLower) {
          const filtered: IssueRuntimeState[] = [];
          for (const state of states) {
            const issue = await provider.getIssue(state.issueId).catch(() => null);
            if ((issue?.title ?? `Issue #${state.issueId}`).toLowerCase().includes(searchLower)) {
              filtered.push(state);
            }
          }
          states = filtered;
        }

        const total = states.length;
        const limited = states.slice(0, limit);

        results.push({
          label: entry.label,
          type: entry.type,
          role: entry.role,
          issues: await summarizeLocalStates(limited, provider, projectionCtx),
          total,
        });
      }

      // Only include states that have issues (unless a specific label was requested)
      const nonEmpty = label ? results : results.filter((r) => r.total > 0);
      const totalIssues = results.reduce((sum, r) => sum + r.total, 0);

      await auditLog(workspaceDir, "task_list", {
        project: project.name,
        stateType: stateType ?? (label ? undefined : "non-terminal"),
        label,
        search,
        totalIssues,
      });

      return jsonResult({
        success: true,
        project: project.name,
        filter: { stateType: stateType ?? null, label: label ?? null, search: search ?? null },
        states: nonEmpty,
        totalIssues,
      });
    },
  });
}

async function summarizeLocalStates(
  states: IssueRuntimeState[],
  provider: Awaited<ReturnType<typeof resolveProvider>>["provider"],
  projectionCtx: Awaited<ReturnType<typeof loadProjectionViewContext>>,
): Promise<TaskIssueSummary[]> {
  const result: TaskIssueSummary[] = [];
  for (const state of states.sort((a, b) => a.issueId - b.issueId)) {
    const issue = await provider.getIssue(state.issueId).catch(() => ({
      iid: state.issueId,
      title: `Issue #${state.issueId}`,
      description: "",
      labels: [],
      state: "unknown",
      web_url: "",
    }));
    result.push(summarizeTaskIssue(issue, projectionCtx));
  }
  return result;
}
