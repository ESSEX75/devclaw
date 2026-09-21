/**
 * config — Config management tool for DevClaw workspaces.
 *
 * Subcommands:
 * - reset: Reset config files to package defaults (with .bak backups)
 * - diff: Show differences between current workflow.yaml and package default
 */
import fs from "node:fs/promises";
import path from "node:path";

import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { DATA_DIR } from "../../state/index.js";
import { backupAndWrite, fileExists, loadSetupTemplates, resetDefaults } from "../../state/index.js";

export function createConfigTool() {
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
      const action = params.action as string;
      const workspacePath = toolCtx.workspaceDir;

      if (!workspacePath) throw new Error("No workspace directory available");

      switch (action) {
        case "reset":
          return await handleReset(workspacePath, (params.scope as string) ?? "all");
        case "diff":
          return await handleDiff(workspacePath);
        default:
          throw new Error(`Unknown config action: ${action}`);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleReset(workspacePath: string, scope: string) {
  const dataDir = path.join(workspacePath, DATA_DIR);
  const written: string[] = [];
  const templates = await loadSetupTemplates();

  if (scope === "all") {
    written.push(...(await resetDefaults(workspacePath)).written);
  } else if (scope === "workflow") {
    const workflowPath = path.join(dataDir, "workflow.yaml");

    await backupAndWrite(workflowPath, templates.workflow);
    written.push("devclaw/workflow.yaml");
  } else if (scope === "prompts") {
    const promptsDir = path.join(dataDir, "prompts");

    for (const [role, content] of Object.entries(templates.roleInstructions)) {
      if (!content) continue;
      const rolePath = path.join(promptsDir, `${role}.md`);

      await backupAndWrite(rolePath, content);
      written.push(`devclaw/prompts/${role}.md`);
    }
  } else {
    throw new Error(`Unknown scope: ${scope}. Use: prompts, workflow, or all.`);
  }

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

async function handleDiff(workspacePath: string) {
  const workflowPath = path.join(workspacePath, DATA_DIR, "workflow.yaml");

  if (!await fileExists(workflowPath)) {
    return jsonResult({
      success: true,
      action: "diff",
      summary: "No workflow.yaml found in workspace — using package defaults.",
    });
  }

  const current = await fs.readFile(workflowPath, "utf-8");
  const template = (await loadSetupTemplates()).workflow;

  if (current.trim() === template.trim()) {
    return jsonResult({
      success: true,
      action: "diff",
      summary: "workflow.yaml matches the package default — no differences.",
    });
  }

  // Simple line-by-line diff
  const currentLines = current.split("\n");
  const templateLines = template.split("\n");
  const diffs: string[] = [];

  const maxLen = Math.max(currentLines.length, templateLines.length);

  for (let i = 0; i < maxLen; i++) {
    const cl = currentLines[i] ?? "";
    const tl = templateLines[i] ?? "";

    if (cl !== tl) {
      if (tl && !cl) diffs.push(`+${i + 1}: ${tl}`);
      else if (cl && !tl) diffs.push(`-${i + 1}: ${cl}`);
      else {
        diffs.push(`-${i + 1}: ${cl}`);
        diffs.push(`+${i + 1}: ${tl}`);
      }
    }
  }

  return jsonResult({
    success: true,
    action: "diff",
    differences: diffs.length,
    summary:
      `workflow.yaml differs from package default (${diffs.length} line(s)):\n\`\`\`diff\n${diffs.join("\n")}\n\`\`\`\n\n` +
      `Use \`config({ action: "reset", scope: "workflow" })\` to reset to defaults.`,
  });
}
