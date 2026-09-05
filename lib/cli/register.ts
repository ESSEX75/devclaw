import type { Command } from "commander";

import type { PluginContext } from "../context.js";
import { registerDoctorCommand } from "./commands/doctor-command.js";
import { registerIssuesArchiveCommand } from "./commands/issues-archive-command.js";
import { registerRepairIssueCommand } from "./commands/repair-issue-command.js";
import { registerSetupCommand } from "./commands/setup-command.js";

export function registerCli(program: Command, ctx: PluginContext): void {
  const devclaw = program
    .command("devclaw")
    .description("DevClaw development pipeline tools");

  registerRepairIssueCommand(devclaw, ctx);
  registerIssuesArchiveCommand(devclaw, ctx);
  registerSetupCommand(devclaw, ctx);
  registerDoctorCommand(devclaw, ctx);
}
