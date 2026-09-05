/** Registers explicit managed-issue repair and policy administration commands. */
import type { Command } from "commander";

import {
  ISSUE_REPAIR_SOURCE,
  type IssueRepairSource,
  migrateIssuePolicies,
  repairManagedIssue,
} from "../../application/issues/index.js";
import type { PluginContext } from "../../context.js";
import type { ReviewPolicy, TestPolicy } from "../../domain/index.js";
import { getDefaultWorkspaceDir } from "../options/setup-options.js";

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
    .description("Plan or apply one managed issue repair")
    .requiredOption("--project <slug>", "Project slug")
    .requiredOption("--issue <id>", "Issue ID")
    .requiredOption("--source <source>", "Repair source: local-state or provider")
    .option("--plan-token <token>", "Token returned by the matching dry-run")
    .option("--dry-run", "Show planned changes without writing")
    .option("--apply", "Apply the repair. Required instead of --dry-run for write mode")
    .option("--workspace <path>", "Workspace path")
    .option("--reason <text>", "Operator reason written to audit events")
    .action(async (opts: {
      project: string;
      issue: string;
      source: string;
      planToken?: string;
      reason?: string;
      dryRun?: boolean;
      apply?: boolean;
      workspace?: string;
    }) => {
      if (opts.dryRun && opts.apply) throw new Error("Choose either --dry-run or --apply, not both.");
      if (!opts.dryRun && !opts.apply) throw new Error("Repair requires an explicit mode: pass --dry-run or --apply.");
      const workspaceDir = opts.workspace ?? getDefaultWorkspaceDir(ctx.runtime);

      if (!workspaceDir) throw new Error("Workspace path is required. Pass --workspace or configure an agent default workspace.");
      if (opts.apply && !opts.planToken) throw new Error("--plan-token from a matching dry-run is required with --apply.");
      const result = await repairManagedIssue({
        workspaceDir,
        projectSlug: opts.project,
        issueId: parseIssueId(opts.issue),
        source: parseRepairSource(opts.source),
        apply: opts.apply === true,
        planToken: opts.planToken,
        reason: opts.reason,
        actor: "cli",
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

function parseIssueId(value: string): number {
  const issueId = Number(value);

  if (!Number.isSafeInteger(issueId) || issueId <= 0) throw new Error(`Invalid issue ID "${value}".`);

  return issueId;
}

function parseRepairSource(value: string): IssueRepairSource {
  if (value === ISSUE_REPAIR_SOURCE.LOCAL_STATE || value === ISSUE_REPAIR_SOURCE.PROVIDER) return value;

  throw new Error(`Invalid repair source "${value}".`);
}
