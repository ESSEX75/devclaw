/**
 * onboard — Conversational DevClaw onboarding.
 *
 * Returns step-by-step guidance. Call this before setup.
 */
import { jsonResult, type OpenClawPluginToolContext, type OpenClawPluginToolFactory } from "openclaw/plugin-sdk/core";

import { getOnboardingContext } from "../../application/setup/index.js";
import type { PluginContext } from "../../context.js";

/** Create the conversational onboarding adapter.
 * @param ctx - Current plugin configuration used for onboarding detection.
 */
export function createOnboardTool(ctx: PluginContext): OpenClawPluginToolFactory {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "onboard",
    label: "Onboard",
    description: "Start DevClaw onboarding workflow. Returns step-by-step QA-style guidance. Call this first, then setup with collected answers.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["first-run", "reconfigure"], description: "Auto-detected if omitted." },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const requestedMode = params.mode;

      if (requestedMode !== undefined && requestedMode !== "first-run" && requestedMode !== "reconfigure") throw new Error("Invalid onboarding mode.");
      const { mode, configured, instructions } = await getOnboardingContext(toolCtx.workspaceDir, ctx.pluginConfig, requestedMode);

      return jsonResult({
        success: true, mode, configured, instructions,
        nextSteps: ["Follow instructions above", "Call setup with collected answers", mode === "first-run" ? "Register a project afterward" : null].filter(Boolean),
      });
    },
  });
}
