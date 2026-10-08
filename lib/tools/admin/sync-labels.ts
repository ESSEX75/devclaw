/**
 * sync_labels — Sync GitHub/GitLab labels with the current workflow config.
 *
 * Creates any missing state labels, role:level labels, and step routing labels
 * from the resolved (three-layer merged) config. Use after editing workflow.yaml
 * to push label changes to your issue tracker.
 *
 * Uses the application workflow-label capability with resolved workspace/project overrides.
 */

import { jsonResult, type OpenClawPluginToolContext, type OpenClawPluginToolFactory } from "openclaw/plugin-sdk/core";

import { ensureWorkflowLabels } from "../../application/index.js";
import { log as auditLog } from "../../audit.js";
import type { PluginContext } from "../../context.js";
import {
  getRoleLabels,
  getStateLabels,
  getStepRoutingLabels,
} from "../../domain/index.js";
import { createProvider } from "../../integrations/index.js";
import { loadConfig } from "../../state/index.js";
import { readProjects } from "../../state/index.js";
import { requireWorkspaceDir } from "../helpers.js";

/** Bind label synchronization to plugin-owned transport and application workflow projection.
 * @param ctx - Plugin dependencies used for explicit provider effects.
 */
export function createSyncLabelsTool(ctx: PluginContext): OpenClawPluginToolFactory {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "sync_labels",
    label: "Sync Labels",
    description:
      "Sync GitHub/GitLab labels with the current workflow config. " +
      "Creates any missing state labels, role:level labels, and step routing labels. " +
      "Use after editing workflow.yaml to push label changes to your issue tracker.",
    parameters: {
      type: "object",
      properties: {
        projectSlug: {
          type: "string",
          description:
            "Canonical project slug to sync. Omit to sync all registered projects.",
        },
      },
    },

    /** Synchronize the selected registered projects without treating invalid input as all-project scope.
     * @param _id - SDK invocation identifier; synchronization does not depend on it.
     * @param params - Optional exact canonical project selection supplied by the tool boundary.
     */
    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const projectSlug = params.projectSlug;

      if (projectSlug !== undefined && (typeof projectSlug !== "string" || !projectSlug)) {
        throw new Error("projectSlug must be a non-empty string when supplied.");
      }

      const data = await readProjects(workspaceDir);
      let slugs: string[];

      if (projectSlug) {
        const project = data.projects[projectSlug];

        if (!project) {
          throw new Error(
            `No project found for slug "${projectSlug}". Register a new project with project_register first.`,
          );
        }

        slugs = [projectSlug];
      } else {
        slugs = Object.keys(data.projects);
      }

      if (slugs.length === 0) {
        return jsonResult({ success: true, synced: [], message: "No projects registered." });
      }

      const results: Array<{
        project: string;
        stateLabels: string[];
        roleLabels: string[];
        routingLabels: string[];
        error?: string;
      }> = [];

      for (const slug of slugs) {
        const project = data.projects[slug];

        if (!project) continue;

        try {
          const resolvedConfig = await loadConfig(workspaceDir, project.slug);

          const { provider } = await createProvider({ repo: project.repo, provider: project.provider, runCommand: ctx.runCommand });

          // State labels from the resolved workflow (not DEFAULT_WORKFLOW)
          const stateLabels = getStateLabels(resolvedConfig.workflow);

          await ensureWorkflowLabels(provider, resolvedConfig.workflow);

          const roleLabels = getRoleLabels(resolvedConfig.roles);
          const routingLabels = getStepRoutingLabels();

          for (const { name, color } of [...roleLabels, ...routingLabels]) {
            await provider.ensureLabel(name, color);
          }

          results.push({
            project: slug,
            stateLabels,
            roleLabels: roleLabels.map((r) => r.name),
            routingLabels: routingLabels.map((label) => label.name),
          });
        } catch (err) {
          results.push({
            project: slug,
            stateLabels: [],
            roleLabels: [],
            routingLabels: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await auditLog(workspaceDir, "sync_labels", {
        projects: results.map((r) => r.project),
        errors: results.filter((r) => r.error).length,
      });

      return jsonResult({
        success: results.every((r) => !r.error),
        synced: results,
      });
    },
  });
}
