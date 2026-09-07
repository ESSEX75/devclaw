import type { Command } from "commander";

import { runSetup } from "../../application/setup/index.js";
import {
  ensureRequiredOpenClawScopes,
  isScopeApprovalRejectedError,
  isScopeApprovalRequiredError,
} from "../../application/setup/scopes.js";
import type { PluginContext } from "../../context.js";
import { getAllDefaultModels, getAllRoleIds, getLevelsForRole } from "../../roles/index.js";
import {
  normalizeChannelBinding,
  normalizeProjectExecution,
  type SetupCliOptions,
} from "../options/setup-options.js";
import {
  collectInteractiveSetupDetails,
  printSelectedSetupTarget,
  resolveSetupCliOptions,
} from "../prompts/channel-prompts.js";

export function registerSetupCommand(parent: Command, ctx: PluginContext): void {
  const setupCmd = parent
    .command("setup")
    .description("Set up DevClaw: create agent, configure models, write workspace files")
    .option("--new-agent <name>", "Create a new agent with this name")
    .option("--agent <id>", "Use an existing agent by ID")
    .option("--workspace <path>", "Direct workspace path")
    .option("--channel-binding <channel>", "Channel binding for a new agent: telegram, whatsapp, or none")
    .option("--channel-account-id <id>", "Explicit channel account id for the binding")
    .option("--channel-peer-id <id>", "Exact group/topic peer id for the binding, e.g. -100123:topic:331")
    .option("--project-execution <mode>", "Project execution mode: parallel or sequential")
    .option("--dry-run", "Print the setup plan without writing configuration or workspace files")
    .option("--eject-defaults", "Write missing packaged defaults into the workspace");

  const defaults = getAllDefaultModels();

  for (const role of getAllRoleIds()) {
    for (const level of getLevelsForRole(role)) {
      const flag = `--${role}-${level}`;

      setupCmd.option(`${flag} <model>`, `${role.toUpperCase()} ${level} model (default: ${defaults[role]?.[level] ?? "auto"})`);
    }
  }

  setupCmd.action(async (rawOpts: SetupCliOptions) => {
    try {
      const opts = await collectInteractiveSetupDetails(
        await resolveSetupCliOptions(rawOpts, ctx.runtime),
        ctx.runtime,
      );

      printSelectedSetupTarget(opts, ctx.runtime);

      const models: Record<string, Record<string, string>> = {};

      for (const role of getAllRoleIds()) {
        const roleModels: Record<string, string> = {};

        for (const level of getLevelsForRole(role)) {
          const key = `${role}${level.charAt(0).toUpperCase()}${level.slice(1)}`;
          const model = opts[key];

          if (typeof model === "string" && model) roleModels[level] = model;
        }

        if (Object.keys(roleModels).length > 0) models[role] = roleModels;
      }

      const scopePreflight = opts.dryRun
        ? undefined
        : await ensureRequiredOpenClawScopes(ctx.runCommand);
      const result = await runSetup({
        runtime: ctx.runtime,
        newAgentName: opts.newAgent,
        channelBinding: normalizeChannelBinding(opts.channelBinding),
        channelAccountId: opts.channelAccountId,
        channelPeerId: opts.channelPeerId,
        agentId: opts.agent,
        workspacePath: opts.workspace,
        models: Object.keys(models).length > 0 ? models : undefined,
        ejectDefaults: opts.ejectDefaults === true,
        projectExecution: normalizeProjectExecution(opts.projectExecution),
        dryRun: opts.dryRun === true,
      });

      printSetupResult(result, scopePreflight);
    } catch (err) {
      if (isScopeApprovalRequiredError(err)) {
        console.error("OpenClaw scope approval required.");
        console.error(`Missing scopes: ${err.missingScopes.join(", ")}`);
        console.error(`Approval request: ${err.requestId}`);
        console.error("Approve this request in OpenClaw UI or CLI, then rerun: openclaw devclaw setup");
        process.exitCode = 1;

        return;
      }

      if (isScopeApprovalRejectedError(err)) {
        console.error(err.message);
        process.exitCode = 1;

        return;
      }

      throw err;
    }
  });
}

function printSetupResult(
  result: Awaited<ReturnType<typeof runSetup>>,
  scopePreflight: Awaited<ReturnType<typeof ensureRequiredOpenClawScopes>> | undefined,
): void {
  if (result.dryRun) {
    console.log("Setup dry-run plan:");
    for (const change of result.plannedChanges) console.log(`  - ${change}`);

    return;
  }

  if (result.agentCreated) {
    console.log(`Agent "${result.agentId}" created`);
  }

  console.log("Setup target:");
  console.log(`  Agent: ${result.agentId}`);
  console.log(`  Workspace: ${result.workspacePath}`);
  console.log(`  Channel binding: ${result.channelBinding ?? "none"}`);
  if (result.channelAccountId) console.log(`  Channel account: ${result.channelAccountId}`);
  if (result.channelPeerId) console.log(`  Channel peer: ${result.channelPeerId}`);

  console.log(`  Workspace defaults: ${result.defaultsEjected ? "ejected packaged defaults" : "safe defaults"}`);

  console.log("Models configured:");
  for (const [role, levels] of Object.entries(result.models)) {
    for (const [level, model] of Object.entries(levels)) {
      console.log(`  ${role}.${level}: ${model}`);
    }
  }

  console.log("Files written:");
  for (const file of result.filesWritten) {
    console.log(`  ${file}`);
  }

  if (scopePreflight?.status === "approved") {
    console.log("\nOpenClaw scopes: approved");
  }

  if (scopePreflight?.warning) {
    console.log("\nOpenClaw scopes warning:");
    console.log(`  ${scopePreflight.warning}`);
  }

  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of result.warnings) {
      console.log(`  ${w}`);
    }
  }

  console.log("\nDone!");
  console.log("Next steps are messages/actions, not shell menu choices:");
  console.log("  - Restart the OpenClaw gateway so the new bot/chat binding becomes active.");
  console.log("  - Add the bot to the selected Telegram/WhatsApp chat.");
  console.log('  - In that group, send: "Register project <name> at <repo> with base branch <branch>".');
  console.log("  - Create the first issue and ask DevClaw to pick it up.");
}
