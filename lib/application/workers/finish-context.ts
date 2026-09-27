/** Resolves configured completion semantics and one unambiguous active worker slot. */

import { getRoleWorker, isConfiguredRoleId, loadConfig } from "../../state/index.js";
import { getRule } from "../pipeline/index.js";
import { resolveProject } from "../projects/index.js";
import { auditWorkFinishRejectedMissingActiveWorker } from "./audit.js";
import type { FinishWorkContext, FinishWorkInput } from "./types.js";

/** Capture an exact run without treating a missing session key as a match for another caller.
 * @param input - Requested role, result, and optional exact caller session.
 */
export async function loadFinishWorkContext(input: FinishWorkInput): Promise<FinishWorkContext> {
  const { workspaceDir, role, result } = input;
  const { project } = await resolveProject(workspaceDir, input.channelId);
  const config = await loadConfig(workspaceDir, project.slug);

  if (!isConfiguredRoleId(config, role)) throw new Error(`Unknown worker role "${role}".`);
  const resolvedRole = config.roles[role];

  if (!resolvedRole?.completion[result]) {
    throw new Error(`${role.toUpperCase()} cannot complete with "${result}". Valid results: ${Object.keys(resolvedRole?.completion ?? {}).join(", ")}`);
  }

  if (!getRule(role, result, resolvedRole.completion, config.workflow)) throw new Error(`Invalid completion: ${role}:${result}`);
  const roleWorker = getRoleWorker(project, role);
  const matches: FinishWorkContext[] = [];

  for (const level of Object.keys(resolvedRole.levels)) {
    for (const [slotIndex, slot] of (roleWorker.levels[level] ?? []).entries()) {
      if (!slot.active || slot.issueId === null || (input.sessionKey && slot.sessionKey !== input.sessionKey)) continue;
      matches.push({ project, config, issueId: slot.issueId, worker: {
        role, level, slotIndex, sessionKey: slot.sessionKey, startedAt: slot.startTime ?? "",
      } });
    }
  }

  if (matches.length > 1) throw new Error(`Multiple active ${role} workers match; supply the exact session key.`);
  const context = matches[0];

  if (context) return context;
  await auditWorkFinishRejectedMissingActiveWorker({ workspaceDir, projectName: project.name, projectSlug: project.slug,
    role, result, sessionKey: input.sessionKey, roleWorker, workflow: config.workflow });
  throw new Error(`${role.toUpperCase()} worker not active on ${project.name}`);
}
