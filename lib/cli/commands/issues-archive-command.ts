/** Registers archive status/purge and confirmed provider issue deletion commands. */
import type { Command } from "commander";

import { deleteManagedIssue, getIssueArchiveStatus, purgeIssueArchive } from "../../application/issues/index.js";
import type { PluginContext } from "../../context.js";
import { loadConfig } from "../../state/config/index.js";
import { resetIssueStores } from "../../state/issues/index.js";
import { readProjects } from "../../state/projects/index.js";
import { resolveProvider } from "../../tools/helpers.js";
import { getDefaultWorkspaceDir } from "../options/setup-options.js";

/** Register non-legacy issue archive and deletion CLI operations. */
export function registerIssuesArchiveCommand(parent: Command, ctx: PluginContext): void {
  const issues = parent.command("issues").description("Manage active and archived issue state");
  const archive = issues.command("archive").description("Inspect or purge the dedicated issue archive");

  archive.command("status")
    .requiredOption("--project <slug>", "Project slug")
    .option("--workspace <path>", "Workspace path")
    .action(async (opts: { project: string; workspace?: string }) => {
      const workspaceDir = requireWorkspace(opts.workspace, ctx);
      const config = await loadConfig(workspaceDir, opts.project);

      console.log(JSON.stringify(await getIssueArchiveStatus({
        workspaceDir,
        projectSlug: opts.project,
        archiveRetention: config.issueArchiveMaintenance.archiveRetention,
        deletedProviderRetention: config.issueArchiveMaintenance.deletedProviderRetention,
        workflow: config.workflow,
      }), null, 2));
    });

  archive.command("purge")
    .requiredOption("--project <slug>", "Project slug")
    .option("--dry-run", "Show expired records without deleting them")
    .option("--apply", "Delete expired records")
    .option("--workspace <path>", "Workspace path")
    .action(async (opts: { project: string; dryRun?: boolean; apply?: boolean; workspace?: string }) => {
      requireExclusiveMode(opts.dryRun, opts.apply);
      const workspaceDir = requireWorkspace(opts.workspace, ctx);
      const config = await loadConfig(workspaceDir, opts.project);

      console.log(JSON.stringify(await purgeIssueArchive({
        workspaceDir,
        projectSlug: opts.project,
        archiveRetention: config.issueArchiveMaintenance.archiveRetention,
        deletedProviderRetention: config.issueArchiveMaintenance.deletedProviderRetention,
        maxItems: config.issueArchiveMaintenance.maxPerHeartbeat,
        apply: opts.apply === true,
        actor: "cli",
        correlationId: `archive-purge:${opts.project}:${Date.now()}`,
      }), null, 2));
    });

  issues.command("delete")
    .requiredOption("--project <slug>", "Project slug")
    .requiredOption("--issue <id>", "Issue ID")
    .option("--confirm-issue <id>", "Exact issue ID confirmation required with --apply")
    .option("--dry-run", "Preview deletion")
    .option("--apply", "Delete the provider issue and archive a tombstone")
    .option("--workspace <path>", "Workspace path")
    .action(async (opts: { project: string; issue: string; confirmIssue?: string; dryRun?: boolean; apply?: boolean; workspace?: string }) => {
      requireExclusiveMode(opts.dryRun, opts.apply);
      const workspaceDir = requireWorkspace(opts.workspace, ctx);
      const projects = await readProjects(workspaceDir);
      const project = projects.projects[opts.project];

      if (!project) throw new Error(`Project "${opts.project}" not found.`);
      const { provider } = await resolveProvider(workspaceDir, project, ctx.runCommand);

      console.log(JSON.stringify(await deleteManagedIssue({
        workspaceDir,
        projectSlug: project.slug,
        issueId: parseIssueId(opts.issue),
        confirmIssueId: opts.confirmIssue ? parseIssueId(opts.confirmIssue) : undefined,
        dryRun: opts.apply !== true,
        provider,
        actor: "cli",
      }), null, 2));
    });

  issues.command("reset-store")
    .description("Destructively replace active and archive stores with empty current-format files")
    .requiredOption("--project <slug>", "Project slug")
    .requiredOption("--confirm-project <slug>", "Must exactly match --project")
    .option("--workspace <path>", "Workspace path")
    .action(async (opts: { project: string; confirmProject: string; workspace?: string }) => {
      if (opts.confirmProject !== opts.project) throw new Error("--confirm-project must exactly match --project.");
      const workspaceDir = requireWorkspace(opts.workspace, ctx);

      await resetIssueStores(workspaceDir, opts.project);
      console.log(JSON.stringify({ projectSlug: opts.project, reset: true }, null, 2));
    });
}

function requireWorkspace(explicit: string | undefined, ctx: PluginContext): string {
  const workspace = explicit ?? getDefaultWorkspaceDir(ctx.runtime);

  if (!workspace) throw new Error("Workspace path is required.");

  return workspace;
}

function requireExclusiveMode(dryRun: boolean | undefined, apply: boolean | undefined): void {
  if (dryRun && apply) throw new Error("Choose either --dry-run or --apply.");
  if (!dryRun && !apply) throw new Error("Choose an explicit mode: --dry-run or --apply.");
}

function parseIssueId(value: string): number {
  const issueId = Number(value);

  if (!Number.isInteger(issueId) || issueId <= 0) throw new Error(`Invalid issue ID "${value}".`);

  return issueId;
}
