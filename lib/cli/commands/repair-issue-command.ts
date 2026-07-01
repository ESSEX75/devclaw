import type { Command } from "commander";
import type { PluginContext } from "../../context.js";
import { repairIssueFromLocalState } from "../../tools/issues/issue-repair.js";
import { getDefaultWorkspaceDir } from "../options/setup-options.js";

export function registerRepairIssueCommand(parent: Command, ctx: PluginContext): void {
  const repairCmd = parent
    .command("repair")
    .description("Repair DevClaw-managed provider projections");

  repairCmd
    .command("issue")
    .description("Repair one issue projection from local state")
    .requiredOption("--project <slug>", "Project slug")
    .requiredOption("--issue <id>", "Issue ID")
    .requiredOption("--source <source>", "Repair source; only local-state is supported")
    .option("--dry-run", "Show planned changes without writing")
    .option("--apply", "Apply the repair. Required instead of --dry-run for write mode")
    .option("--workspace <path>", "Workspace path")
    .action(async (opts: { project: string; issue: string; source: string; dryRun?: boolean; apply?: boolean; workspace?: string }) => {
      if (opts.dryRun && opts.apply) throw new Error("Choose either --dry-run or --apply, not both.");
      if (!opts.dryRun && !opts.apply) throw new Error("Repair requires an explicit mode: pass --dry-run or --apply.");
      const workspaceDir = opts.workspace ?? getDefaultWorkspaceDir(ctx.runtime);
      if (!workspaceDir) throw new Error("Workspace path is required. Pass --workspace or configure an agent default workspace.");
      const result = await repairIssueFromLocalState({
        workspaceDir,
        projectSlug: opts.project,
        issueId: Number(opts.issue),
        source: opts.source,
        dryRun: !opts.apply,
        runCommand: ctx.runCommand,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
