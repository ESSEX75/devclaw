/**
 * setup — Agent-driven DevClaw setup.
 *
 * Creates agent, configures model levels, writes workspace files.
 * Thin wrapper around application setup orchestration.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import {
  isSetupNotificationChannel,
  runSetup,
  SETUP_NOTIFICATION_CHANNELS,
  type SetupOpts,
} from "../../application/setup/index.js";
import {
  ensureRequiredOpenClawScopes,
  isScopeApprovalRejectedError,
  isScopeApprovalRequiredError,
} from "../../application/setup/scopes.js";
import type { PluginContext } from "../../context.js";
import { EXECUTION_MODE, type ExecutionMode } from "../../domain/index.js";
import { writeAllDefaults } from "../../state/setup/workspace-files.js";

export function createSetupTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "setup",
    label: "Setup",
    description:
      `Execute DevClaw setup. Creates AGENTS.md, HEARTBEAT.md, TOOLS.md, devclaw/projects.json, ` +
      `devclaw/prompts/, and model level config. Optionally creates a new agent with channel binding. ` +
      `Called after onboard collects configuration.`,
    parameters: {
      type: "object",
      properties: {
        newAgentName: {
          type: "string",
          description:
            "Create a new agent. Omit to configure current workspace.",
        },
        channelBinding: {
          type: "string",
          enum: SETUP_NOTIFICATION_CHANNELS,
          description: "Channel to bind to the selected or newly-created agent.",
        },
        channelAccountId: {
          type: "string",
          description: "Explicit channel account id required when channelBinding is set, e.g. Telegram account 'dev'.",
        },
        channelPeerId: {
          type: "string",
          description: "Exact group/chat/topic peer id required when channelBinding is set, e.g. '-1003911014709:topic:331'.",
        },
        models: {
          type: "object",
          description: "Model overrides keyed by configured role and level.",
          additionalProperties: {
            type: "object",
            additionalProperties: {
              type: "string",
            },
          },
        },
        projectExecution: {
          type: "string",
          enum: Object.values(EXECUTION_MODE),
          description: "Project execution mode. Default: parallel.",
        },
        ejectDefaults: {
          type: "boolean",
          description: "Write all package defaults to workspace. Skips files that already exist.",
        },
        resetDefaults: {
          type: "boolean",
          description: "Force-write all package defaults to workspace, overwriting existing files. Creates .bak backups.",
        },
        dryRun: {
          type: "boolean",
          description: "Return the setup plan without writing OpenClaw or workspace configuration.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      // Handle --eject-defaults and --reset-defaults (standalone operations)
      if (params.ejectDefaults || params.resetDefaults) {
        const workspacePath = toolCtx.workspaceDir;

        if (!workspacePath) throw new Error("No workspace directory available");
        const force = !!params.resetDefaults;
        const written = await writeAllDefaults(workspacePath, force);
        const action = force ? "Reset (force-wrote)" : "Ejected (wrote missing)";

        return jsonResult({
          success: true,
          action: force ? "reset-defaults" : "eject-defaults",
          filesWritten: written,
          summary: written.length > 0
            ? `${action} ${written.length} file(s):\n${written.map(f => `  ${f}`).join("\n")}`
            : "All files already exist — nothing to write.",
        });
      }

      let scopePreflight: Awaited<ReturnType<typeof ensureRequiredOpenClawScopes>> | undefined;
      let result: Awaited<ReturnType<typeof runSetup>>;
      const channelBindingInput = params.channelBinding;

      if (
        channelBindingInput !== undefined
        && !isSetupNotificationChannel(channelBindingInput)
      ) {
        throw new Error(`Unsupported setup channel: ${String(channelBindingInput)}.`);
      }

      try {
        scopePreflight = params.dryRun === true
          ? undefined
          : await ensureRequiredOpenClawScopes(ctx.runCommand);
        result = await runSetup({
          runtime: ctx.runtime,
          newAgentName: params.newAgentName as string | undefined,
          channelBinding: channelBindingInput ?? null,
          channelAccountId:
            typeof params.channelAccountId === "string" ? params.channelAccountId : undefined,
          channelPeerId:
            typeof params.channelPeerId === "string" ? params.channelPeerId : undefined,
          agentId: params.newAgentName ? undefined : toolCtx.agentId,
          workspacePath: params.newAgentName ? undefined : toolCtx.workspaceDir,
          models: params.models as SetupOpts["models"],
          projectExecution: params.projectExecution as
            | ExecutionMode
            | undefined,
          dryRun: params.dryRun === true,
        });
      } catch (err) {
        if (isScopeApprovalRequiredError(err)) {
          return jsonResult({
            success: false,
            status: "PENDING_APPROVAL",
            requiredScopes: err.requiredScopes,
            missingScopes: err.missingScopes,
            requestId: err.requestId,
            summary:
              `OpenClaw approval is required before DevClaw setup can continue.\n` +
              `Approve request ${err.requestId} in OpenClaw UI or CLI, then call setup again.`,
          });
        }

        if (isScopeApprovalRejectedError(err)) {
          return jsonResult({
            success: false,
            status: err.status.toUpperCase(),
            requestId: err.requestId,
            summary: err.message,
          });
        }

        throw err;
      }

      const lines = [
        result.agentCreated
          ? `Agent "${result.agentId}" created`
          : `Configured "${result.agentId}"`,
        "",
      ];


      lines.push("Models:");
      for (const [role, levels] of Object.entries(result.models)) {
        for (const [level, model] of Object.entries(levels)) {
          lines.push(`  ${role}.${level}: ${model}`);
        }
      }

      lines.push("");

      lines.push("Files:", ...result.filesWritten.map((f) => `  ${f}`));

      if (result.dryRun) {
        return jsonResult({ success: true, ...result, summary: `Setup dry-run:\n${result.plannedChanges.map((change) => `  - ${change}`).join("\n")}` });
      }

      if (scopePreflight?.status === "approved") {
        lines.push("", "OpenClaw scopes: approved");
      }

      if (scopePreflight?.warning) {
        lines.push("", "OpenClaw scopes warning:", `  ${scopePreflight.warning}`);
      }

      if (result.warnings.length > 0)
        lines.push("", "Warnings:", ...result.warnings.map((w) => `  ${w}`));
      lines.push(
        "",
        "Done!",
        "",
        "Next steps are messages/actions, not shell menu choices:",
        "  - Restart the OpenClaw gateway so the new bot/chat binding becomes active.",
        "  - Add the bot to the selected Telegram/WhatsApp chat.",
        '  - In that group, send: "Register project <name> at <repo> with base branch <branch>".',
        "  - Create the first issue and ask DevClaw to pick it up.",
      );

      return jsonResult({
        success: true,
        ...result,
        summary: lines.join("\n"),
      });
    },
  });
}
