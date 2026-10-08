/** Registers SDK bootstrap handling and replaces instructions only for an exactly identified DevClaw worker. */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import type { PluginContext } from "../../../context.js";
import { WORKER_BOOTSTRAP_FILE, WORKER_BOOTSTRAP_HOOK, WORKER_BOOTSTRAP_REGISTRATION } from "./const.js";
import { isWorkerBootstrapContext } from "./guards.js";
import type { BootstrapHookActions, BootstrapInstructionIdentity } from "./types.js";

/** Register instruction replacement for sessions matched to an exact saved worker slot.
 * Unregistered or unscoped sessions remain untouched. Confirmed workers lose orchestrator
 * instructions before loading their role prompt, including when prompt loading fails.
 * @param api - SDK capability for internal bootstrap hook registration.
 * @param ctx - Plugin diagnostics used to report the selected instruction source.
 * @param actions - Application-owned identity resolution and instruction loading wired by composition.
 */
export function registerBootstrapHook<TIdentity extends BootstrapInstructionIdentity>(
  api: Pick<OpenClawPluginApi, "registerHook">,
  ctx: Pick<PluginContext, "logger">,
  actions: BootstrapHookActions<TIdentity>,
): void {
  api.registerHook(WORKER_BOOTSTRAP_HOOK, async event => {
    if (!event.sessionKey || !isWorkerBootstrapContext(event.context)) return;
    const context = event.context;
    const agentsEntry = context.bootstrapFiles.find(file => file.name === WORKER_BOOTSTRAP_FILE);

    if (!agentsEntry) return;
    const identity = await actions.resolveWorkerBootstrapIdentity(context.workspaceDir, event.sessionKey);

    if (!identity) return;
    agentsEntry.content = "";
    agentsEntry.missing = true;
    const { content, source } = await actions.loadWorkerBootstrapInstructions(context.workspaceDir, identity);

    if (content.trim()) {
      agentsEntry.content = content;
      agentsEntry.missing = false;
    }

    ctx.logger.info(`agent:bootstrap: ${content.trim() ? "injected" : "stripped"} ${identity.role} instructions for "${identity.projectSlug}" from ${source}`);
  }, { name: WORKER_BOOTSTRAP_REGISTRATION, description: "Replaces orchestrator AGENTS.md with role-specific instructions for DevClaw workers" });
}
