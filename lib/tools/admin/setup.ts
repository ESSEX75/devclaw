/**
 * setup — Agent-driven DevClaw setup.
 *
 * Creates agent, configures model levels, writes workspace files.
 * Thin wrapper around application setup orchestration.
 */
import { jsonResult, type OpenClawPluginToolContext, type OpenClawPluginToolFactory } from "openclaw/plugin-sdk/core";
import { z } from "zod";

import {
  isSetupNotificationChannel,
  runSetup,
  SETUP_NOTIFICATION_CHANNELS,
  type SetupOpts,
} from "../../application/setup/index.js";
import {
  isScopeApprovalRejectedError,
  isScopeApprovalRequiredError,
} from "../../application/setup/index.js";
import { EXECUTION_MODE } from "../../domain/index.js";

/** Validate optional tool inputs without trusting schema enforcement by the caller. */
const setupInput = z.object({
  newAgentName: z.string().min(1).optional(),
  channelBinding: z.string().optional(),
  channelAccountId: z.string().optional(),
  channelPeerId: z.string().optional(),
  models: z.record(z.string(), z.record(z.string(), z.string().min(1))).optional(),
  projectExecution: z.enum(EXECUTION_MODE).optional(),
  ejectDefaults: z.boolean().optional(),
  resetDefaults: z.boolean().optional(),
  refreshInstructions: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

/** Create the setup adapter with validated tool inputs and application-owned effects.
 * @param ctx - Setup runtime and command transport.
 */
export function createSetupTool(ctx: Pick<SetupOpts, "runtime" | "runCommand">): OpenClawPluginToolFactory {
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
        refreshInstructions: {
          type: "boolean",
          description: "Refresh system instructions only, preserving .bak backups.",
        },
        dryRun: {
          type: "boolean",
          description: "Return the setup plan without writing OpenClaw or workspace configuration.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const input = setupInput.parse(params);
      let result: Awaited<ReturnType<typeof runSetup>>;
      const channelBindingInput = input.channelBinding;

      if (
        channelBindingInput !== undefined
        && !isSetupNotificationChannel(channelBindingInput)
      ) {
        throw new Error(`Unsupported setup channel: ${String(channelBindingInput)}.`);
      }

      try {
        result = await runSetup({
          runtime: ctx.runtime,
          runCommand: ctx.runCommand,
          newAgentName: input.newAgentName,
          channelBinding: channelBindingInput ?? null,
          channelAccountId:
            typeof input.channelAccountId === "string" ? input.channelAccountId : undefined,
          channelPeerId:
            typeof input.channelPeerId === "string" ? input.channelPeerId : undefined,
          agentId: input.newAgentName ? undefined : toolCtx.agentId,
          workspacePath: input.newAgentName ? undefined : toolCtx.workspaceDir,
          models: input.models,
          projectExecution: input.projectExecution,
          dryRun: input.dryRun === true,
          ejectDefaults: input.ejectDefaults,
          resetDefaults: input.resetDefaults,
          refreshInstructions: input.refreshInstructions,
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

      if (result.operation !== "configure") {
        return jsonResult({ success: true, ...result, summary: result.dryRun
          ? `Setup dry-run: ${result.plannedChanges.join("; ")}`
          : `${result.operation}: ${result.filesWritten.length} files written` });
      }

      const scopePreflight = result.scopePreflight;
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
