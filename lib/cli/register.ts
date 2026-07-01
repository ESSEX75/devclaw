import type { Command } from "commander";
import type { PluginContext } from "../context.js";
import { registerIssuesCleanupCommand } from "./commands/issues-cleanup-command.js";
import { registerRepairIssueCommand } from "./commands/repair-issue-command.js";
import { registerSetupCommand } from "./commands/setup-command.js";

export function registerCli(program: Command, ctx: PluginContext): void {
  const devclaw = program
    .command("devclaw")
    .description("DevClaw development pipeline tools");

  registerRepairIssueCommand(devclaw, ctx);
  registerIssuesCleanupCommand(devclaw, ctx);
  registerSetupCommand(devclaw, ctx);
}
