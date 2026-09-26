/**
 * config — Config management tool for DevClaw workspaces.
 *
 * Subcommands:
 * - reset: Reset config files to package defaults (with .bak backups)
 * - diff: Show differences between current workflow.yaml and package default
 */
import { jsonResult, type OpenClawPluginToolContext, type OpenClawPluginToolFactory } from "openclaw/plugin-sdk/core";

import { compareWorkspaceConfig, resetWorkspaceConfig } from "../../application/setup/index.js";

/** Create the adapter for explicit configuration reset and read-only comparison. */
export function createConfigTool(): OpenClawPluginToolFactory {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "config",
    label: "Config",
    description: `Manage DevClaw workspace configuration.

Actions:
- **reset**: Reset config files to package defaults. Creates .bak backups of existing files.
  Scope: --prompts (prompts only), --workflow (workflow.yaml only), --all (everything).
- **diff**: Show differences between current workflow.yaml and the package default template.

Examples:
  config({ action: "reset", scope: "workflow" })
  config({ action: "reset", scope: "all" })
  config({ action: "diff" })`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["reset", "diff"],
          description: "Config action to perform.",
        },
        scope: {
          type: "string",
          enum: ["prompts", "workflow", "all"],
          description: "Scope for reset action. Default: all.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const action = params.action;
      const workspacePath = toolCtx.workspaceDir;

      if (!workspacePath) throw new Error("No workspace directory available");

      switch (action) {
        case "reset":
          return await handleReset(workspacePath, params.scope ?? "all");
        case "diff":
          return await handleDiff(workspacePath);
        default:
          throw new Error(`Unknown config action: ${String(action)}`);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Render the result of an explicitly selected configuration reset.
 * @param workspacePath - Resolved tool workspace.
 * @param scope - Untrusted reset subset, validated before application dispatch.
 */
async function handleReset(workspacePath: string, scope: unknown) {
  if (scope !== "all" && scope !== "workflow" && scope !== "prompts") throw new Error("Unknown reset scope.");
  const written = await resetWorkspaceConfig(workspacePath, scope);

  return jsonResult({
    success: true,
    action: "reset",
    scope,
    filesWritten: written,
    summary: written.length > 0
      ? `Reset ${written.length} file(s) to package defaults (.bak backups created):\n${written.map(f => `  ${f}`).join("\n")}`
      : "No files to reset.",
  });
}

/** Render a read-only comparison against packaged workflow defaults.
 * @param workspacePath - Resolved tool workspace.
 */
async function handleDiff(workspacePath: string) {
  const result = await compareWorkspaceConfig(workspacePath);

  if (result.missing) {
    return jsonResult({
      success: true,
      action: "diff",
      summary: "No workflow.yaml found in workspace — using package defaults.",
    });
  }

  if (!result.differences.length) {
    return jsonResult({
      success: true,
      action: "diff",
      summary: "workflow.yaml matches the package default — no differences.",
    });
  }

  const diffs = result.differences;

  return jsonResult({
    success: true,
    action: "diff",
    differences: diffs.length,
    summary:
      `workflow.yaml differs from package default (${diffs.length} line(s)):\n\`\`\`diff\n${diffs.join("\n")}\n\`\`\`\n\n` +
      `Use \`config({ action: "reset", scope: "workflow" })\` to reset to defaults.`,
  });
}
