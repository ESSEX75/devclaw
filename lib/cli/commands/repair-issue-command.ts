import type { Command } from "commander";
import type { PluginContext } from "../../context.js";
import { migrateIssuePolicies, repairIssueFromLocalState } from "../../tools/issues/issue-repair.js";
import { getDefaultWorkspaceDir } from "../options/setup-options.js";
import type { ReviewPolicy, TestPolicy } from "../../domain/workflow/index.js";

function parseReviewPolicy(value: string | undefined): ReviewPolicy | undefined {
  if (value === undefined) return undefined;
  if (value === "human" || value === "agent" || value === "skip") return value;
  throw new Error(`Invalid review policy "${value}". Use human, agent, or skip.`);
}

function parseTestPolicy(value: string | undefined): TestPolicy | undefined {
  if (value === undefined) return undefined;
  if (value === "agent" || value === "skip") return value;
  throw new Error(`Invalid test policy "${value}". Use agent or skip.`);
}

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

  repairCmd
    .command("policies")
    .description("Migrate review/test policy snapshots for existing managed issues")
    .requiredOption("--project <slug>", "Project slug")
    .option("--review <policy>", "Set review policy: human, agent, or skip")
    .option("--test <policy>", "Set test policy: agent or skip")
    .option("--issue <ids>", "Comma-separated issue IDs to migrate")
    .option("--state <states>", "Comma-separated workflow state keys to filter")
    .option("--include-closed", "Include closed/done/rejected issues")
    .option("--dry-run", "Show planned changes without writing")
    .option("--apply", "Apply the migration. Required instead of --dry-run for write mode")
    .option("--workspace <path>", "Workspace path")
    .action(async (opts: {
      project: string;
      review?: string;
      test?: string;
      issue?: string;
      state?: string;
      includeClosed?: boolean;
      dryRun?: boolean;
      apply?: boolean;
      workspace?: string;
    }) => {
      if (opts.dryRun && opts.apply) throw new Error("Choose either --dry-run or --apply, not both.");
      if (!opts.dryRun && !opts.apply) throw new Error("Policy migration requires an explicit mode: pass --dry-run or --apply.");
      const workspaceDir = opts.workspace ?? getDefaultWorkspaceDir(ctx.runtime);
      if (!workspaceDir) throw new Error("Workspace path is required. Pass --workspace or configure an agent default workspace.");
      const result = await migrateIssuePolicies({
        workspaceDir,
        projectSlug: opts.project,
        reviewPolicy: parseReviewPolicy(opts.review),
        testPolicy: parseTestPolicy(opts.test),
        issueIds: opts.issue ? opts.issue.split(",").map((id) => Number(id.trim())).filter((id) => Number.isFinite(id)) : undefined,
        workflowStates: opts.state ? opts.state.split(",").map((state) => state.trim()).filter(Boolean) : undefined,
        includeClosed: opts.includeClosed,
        dryRun: !opts.apply,
        runCommand: ctx.runCommand,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
