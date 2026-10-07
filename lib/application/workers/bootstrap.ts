/** Resolves bootstrap instruction ownership from saved slots rather than built-in role names. */

import { formatWorkerSessionKey } from "../../integrations/openclaw/sessions/index.js";
import { isConfiguredRoleId, loadConfig, loadRoleInstructions, readOptionalProjects, type RoleInstructionsResult } from "../../state/index.js";
import type { WorkerBootstrapIdentity } from "./types.js";

/** Resolve one exact session's instruction owner, including custom roles and hyphenated levels.
 * Unregistered sessions remain untouched; ambiguous ownership and corrupt state fail closed.
 * Slot identity selects instructions only and never establishes issue workflow or active ownership.
 * @param workspaceDir - SDK-resolved workspace containing the validated projects registry.
 * @param sessionKey - Exact gateway identity supplied by the bootstrap event.
 */
export async function resolveWorkerBootstrapIdentity(workspaceDir: string, sessionKey: string): Promise<WorkerBootstrapIdentity | null> {
  const registry = await readOptionalProjects(workspaceDir);
  const matches: WorkerBootstrapIdentity[] = [];
  const canonicalKey = sessionKey.toLowerCase();

  for (const project of Object.values(registry?.projects ?? {})) {
    const agentPrefix = formatWorkerSessionKey(project.agentId, "").toLowerCase();

    if (!canonicalKey.startsWith(agentPrefix)) continue;

    for (const [role, worker] of Object.entries(project.workers)) {
      const matchingSlot = Object.values(worker.levels).some(slots =>
        slots?.some(slot => slot.sessionKey?.toLowerCase() === canonicalKey));

      if (matchingSlot) matches.push({ projectSlug: project.slug, role });
    }
  }

  if (matches.length > 1) throw new Error(`Ambiguous bootstrap instruction ownership for session "${sessionKey}".`);
  const identity = matches[0];

  if (!identity) return null;

  return identity;
}

/** Load role instructions only after configuration confirms the persisted role identifier.
 * Removed roles receive no instructions; configuration and filesystem errors propagate.
 * @param workspaceDir - SDK workspace containing configuration and prompt resources.
 * @param identity - Instruction owner proven by exact slot/session matching.
 */
export async function loadWorkerBootstrapInstructions(workspaceDir: string, identity: WorkerBootstrapIdentity): Promise<RoleInstructionsResult> {
  const config = await loadConfig(workspaceDir, identity.projectSlug);

  if (!isConfiguredRoleId(config, identity.role)) return { content: "", source: null };

  return loadRoleInstructions(workspaceDir, identity.projectSlug, identity.role, { withSource: true });
}
