/**
 * bootstrap-hook.ts — Bootstrap support for DevClaw worker sessions.
 *
 * Provides:
 *   1. agent:bootstrap (internal hook) — replaces the orchestrator's AGENTS.md
 *      with role-specific instructions so the worker sees its own prompt on
 *      every turn. Requires hooks.internal.enabled in config.
 *   2. Resolves state-owned role instructions for persistent per-turn injection.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import type { PluginContext } from "../../context.js";
import { getSessionKeyRolePattern } from "../../roles/index.js";
import { loadRoleInstructions } from "../../state/index.js";

/**
 * Parse a DevClaw subagent session key to extract canonical project slug and role.
 *
 * Session key format (named): `agent:{agentId}:subagent:{projectSlug}-{role}-{level}-{name}` (name is lowercase)
 * Session key format (numeric): `agent:{agentId}:subagent:{projectSlug}-{role}-{level}-{slotIndex}`
 * Examples:
 *   - `agent:devclaw:subagent:my-project-developer-medior-ada`  → { projectSlug: "my-project", role: "developer" }
 *   - `agent:devclaw:subagent:my-project-developer-medior-0`    → { projectSlug: "my-project", role: "developer" }
 *
 * Note: projectSlug may contain hyphens, so we match role from the end.
 */
export function parseDevClawSessionKey(
  sessionKey: string,
): { projectSlug: string; role: string } | null {
  const rolePattern = getSessionKeyRolePattern();
  // Named/numeric format: ...-{role}-{level}-{nameOrIndex}
  const newMatch = sessionKey.match(
    new RegExp(`:subagent:(.+)-(${rolePattern})-[^-]+-[^-]+$`),
  );

  if (newMatch) return { projectSlug: newMatch[1], role: newMatch[2] };

  // Architect research sessions are role-level scoped and do not occupy a
  // named worker slot, so their keys end at `{project}-architect-{level}`.
  const architectMatch = sessionKey.match(/:subagent:(.+)-(architect)-[^-]+$/);

  if (architectMatch) return { projectSlug: architectMatch[1], role: architectMatch[2] };

  return null;
}

/**
 * Register the agent:bootstrap hook for DevClaw worker sessions.
 *
 * Replaces the orchestrator's AGENTS.md with role-specific instructions
 * loaded from the workspace. This ensures workers see their own prompt on
 * every turn — not just the dispatch turn (where extraSystemPrompt is used).
 *
 * If role instructions are found, AGENTS.md content is replaced entirely.
 * If none are found, AGENTS.md is still stripped to avoid orchestrator bleed.
 *
 * Requires hooks.internal.enabled in config. If the hook doesn't fire,
 * dispatch.ts still passes instructions via extraSystemPrompt (single-turn).
 */
export function registerBootstrapHook(api: OpenClawPluginApi, ctx: PluginContext): void {
  api.registerHook(
    "agent:bootstrap",
    async (event) => {
      const sessionKey = event.sessionKey;

      if (!sessionKey) return;

      const parsed = parseDevClawSessionKey(sessionKey);

      if (!parsed) return;

      const context = event.context as {
        workspaceDir?: string;
        bootstrapFiles?: Array<{
          name: string;
          path: string;
          content?: string;
          missing: boolean;
        }>;
      };

      const bootstrapFiles = context.bootstrapFiles;

      if (!Array.isArray(bootstrapFiles)) return;

      const agentsEntry = bootstrapFiles.find((f) => f.name === "AGENTS.md");

      if (!agentsEntry) return;

      // Load role instructions from workspace (project-specific → default fallback)
      const workspaceDir = context.workspaceDir;

      if (!workspaceDir) {
        agentsEntry.content = "";
        agentsEntry.missing = true;
        ctx.logger.info(
          `agent:bootstrap: stripped AGENTS.md for ${parsed.role} worker in "${parsed.projectSlug}" (no workspaceDir)`,
        );

        return;
      }

      const { content, source } = await loadRoleInstructions(
        workspaceDir,
        parsed.projectSlug,
        parsed.role,
        { withSource: true },
      );

      if (content.trim()) {
        agentsEntry.content = content;
        agentsEntry.missing = false;
        ctx.logger.info(
          `agent:bootstrap: injected ${parsed.role} instructions for "${parsed.projectSlug}" from ${source}`,
        );
      } else {
        agentsEntry.content = "";
        agentsEntry.missing = true;
        ctx.logger.info(
          `agent:bootstrap: stripped AGENTS.md for ${parsed.role} worker in "${parsed.projectSlug}" (no role instructions found)`,
        );
      }
    },
    {
      name: "devclaw-bootstrap-role-instructions",
      description:
        "Replaces orchestrator AGENTS.md with role-specific instructions for DevClaw workers",
    } as Record<string, unknown>,
  );
}
