/**
 * Registers the shared DevClaw doctor CLI and renders routing/isolation diagnostics.
 */
import type { Command } from "commander";

import { runRoutingDoctor } from "../../application/doctor/index.js";
import type { PluginContext } from "../../context.js";

/** Register `devclaw doctor` on the parent CLI command. */
export function registerDoctorCommand(parent: Command, ctx: PluginContext): void {
  parent
    .command("doctor")
    .description("Validate DevClaw configuration, routing, and agent isolation")
    .option("--workspace <path>", "Workspace containing devclaw/projects.json")
    .action(async (opts: { workspace?: string }) => {
      const workspace = opts.workspace ?? ctx.runtime.config.current().agents?.defaults?.workspace;

      if (!workspace) {
        throw new Error("Doctor requires --workspace when OpenClaw has no default agent workspace.");
      }

      const report = await runRoutingDoctor(ctx.runtime, workspace);

      console.log("DevClaw doctor — routing and isolation");
      for (const finding of report.findings) {
        console.log(`${finding.severity === "error" ? "ERROR" : "OK"} [${finding.code}] ${finding.message}`);
      }

      console.log("\nAgent tool access:");
      for (const agent of report.agents) {
        console.log(`  ${agent.agentId}: ${agent.devclawToolsAllowed ? "allowed" : "denied"}`);
      }

      if (!report.ok) process.exitCode = 1;
    });
}
