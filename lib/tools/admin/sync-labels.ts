/**
 * sync_labels — Sync GitHub/GitLab labels with the current workflow config.
 *
 * Creates any missing state labels, role:level labels, and step routing labels
 * from the resolved (three-layer merged) config. Use after editing workflow.yaml
 * to push label changes to your issue tracker.
 *
 * Calls provider.ensureLabel() directly instead of provider.ensureAllStateLabels()
 * so that custom workflow states from workspace/project overrides are included.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { log as auditLog } from "../../audit.js";
import type { PluginContext } from "../../context.js";
import {
  getLabelColors,
  getRoleLabels,
  getStateLabels,
  getStepRoutingLabels,
} from "../../domain/index.js";
import { createProvider } from "../../integrations/providers/index.js";
import { loadConfig } from "../../state/index.js";
import { readProjects } from "../../state/index.js";
import { requireWorkspaceDir } from "../helpers.js";

export function createSyncLabelsTool(ctx: PluginContext) {
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

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(toolCtx);
      const projectSlug = params.projectSlug as string | undefined;

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

          const { provider } = await createProvider({
            repo: project.repo,
            provider: project.provider,
            runCommand: ctx.runCommand,
            workflow: resolvedConfig.workflow,
          });

          // State labels from the resolved workflow (not DEFAULT_WORKFLOW)
          const stateLabels = getStateLabels(resolvedConfig.workflow);
          const labelColors = getLabelColors(resolvedConfig.workflow);

          for (const label of stateLabels) {
            const color = labelColors.get(label);

            if (!color) throw new Error(`No color configured for workflow label "${label}".`);
            await provider.ensureLabel(label, color);
          }

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
            error: (err as Error).message,
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
