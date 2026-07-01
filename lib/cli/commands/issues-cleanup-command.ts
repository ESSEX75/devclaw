import type { Command } from "commander";
import type { PluginContext } from "../../context.js";
import { cleanupIssueState } from "../../tools/issues/issues-cleanup.js";
import { getDefaultWorkspaceDir } from "../options/setup-options.js";

export function registerIssuesCleanupCommand(parent: Command, ctx: PluginContext): void {
  const issuesCmd = parent
    .command("issues")
    .description("Manage project-local issue state");

  issuesCmd
    .command("cleanup")
    .description("Archive old closed issues into inline archive.issues")
    .requiredOption("--project <slug>", "Project slug")
    .requiredOption("--older-than <duration>", "Retention window, e.g. 30d")
    .option("--workspace <path>", "Workspace path")
    .action(async (opts: { project: string; olderThan: string; workspace?: string }) => {
      const workspaceDir = opts.workspace ?? getDefaultWorkspaceDir(ctx.runtime);
      if (!workspaceDir) throw new Error("Workspace path is required. Pass --workspace or configure an agent default workspace.");
      const result = await cleanupIssueState({
        workspaceDir,
        projectSlug: opts.project,
        olderThan: opts.olderThan,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
