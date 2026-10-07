/** Resolves validated merged configuration into application-facing runtime contracts. */

import { getAllRoleIds } from "../../roles/index.js";
import { DEFAULT_ISSUE_ARCHIVE_MAINTENANCE, DEFAULT_MAX_WORKERS_PER_LEVEL, DEFAULT_TIMEOUTS } from "./const.js";
import { parseResolvedWorkflowConfig, validateRoleIntegrity, validateWorkflowIntegrity } from "./schema.js";
import type { DevClawConfig, LevelOverride, ResolvedConfig, ResolvedLevelConfig, ResolvedRoleConfig, ResolvedTimeouts } from "./types.js";

/**
 * Resolve a validated layered configuration into the complete application-facing runtime contract.
 * Rejects incomplete roles and inconsistent workflow references before returning configuration.
 *
 * @param config - Validated result of the layered merge.
 */
export function resolveConfig(config: DevClawConfig): ResolvedConfig {
  const roles: Record<string, ResolvedRoleConfig> = {};
  const globalMaxWorkers = config.workflow?.maxWorkersPerLevel ?? DEFAULT_MAX_WORKERS_PER_LEVEL;
  const roleErrors = validateRoleIntegrity(config.roles ?? {}, new Set(getAllRoleIds()));

  if (roleErrors.length > 0) throw new Error(`Role config integrity errors:\n  - ${roleErrors.join("\n  - ")}`);

  for (const [id, override] of Object.entries(config.roles ?? {})) {
    if (override === false || !override.levels || !override.defaultLevel || !override.completion) {
      throw new Error(`Cannot resolve incomplete merged role "${id}".`);
    }

    roles[id] = {
      levels: resolveLevels(override.levels, globalMaxWorkers),
      defaultLevel: override.defaultLevel,
      completion: { ...override.completion },
      enabled: override.enabled ?? true,
    };
  }

  const workflow = parseResolvedWorkflowConfig({
    ...config.workflow,
    maxWorkersPerLevel: globalMaxWorkers,
  });
  const workflowErrors = validateWorkflowIntegrity(workflow, new Set(Object.keys(roles)));

  if (workflowErrors.length > 0) throw new Error(`Workflow config integrity errors:\n  - ${workflowErrors.join("\n  - ")}`);

  const timeouts: ResolvedTimeouts = {
    gitPullMs: config.timeouts?.gitPullMs ?? DEFAULT_TIMEOUTS.gitPullMs,
    gatewayMs: config.timeouts?.gatewayMs ?? DEFAULT_TIMEOUTS.gatewayMs,
    sessionPatchMs: config.timeouts?.sessionPatchMs ?? DEFAULT_TIMEOUTS.sessionPatchMs,
    dispatchMs: config.timeouts?.dispatchMs ?? DEFAULT_TIMEOUTS.dispatchMs,
    staleWorkerHours: config.timeouts?.staleWorkerHours ?? DEFAULT_TIMEOUTS.staleWorkerHours,
    sessionContextBudget: config.timeouts?.sessionContextBudget ?? DEFAULT_TIMEOUTS.sessionContextBudget,
    stallTimeoutMinutes: config.timeouts?.stallTimeoutMinutes ?? DEFAULT_TIMEOUTS.stallTimeoutMinutes,
  };

  return {
    roles, workflow, timeouts, instanceName: config.instance?.name,
    issueArchiveMaintenance: {
      deletedProviderRetention: config.issueArchiveMaintenance?.deletedProviderRetention ?? DEFAULT_ISSUE_ARCHIVE_MAINTENANCE.deletedProviderRetention,
      archiveRetention: config.issueArchiveMaintenance?.archiveRetention ?? DEFAULT_ISSUE_ARCHIVE_MAINTENANCE.archiveRetention,
      attachmentsRetention: config.issueArchiveMaintenance?.attachmentsRetention ?? DEFAULT_ISSUE_ARCHIVE_MAINTENANCE.attachmentsRetention,
      maxPerHeartbeat: config.issueArchiveMaintenance?.maxPerHeartbeat ?? DEFAULT_ISSUE_ARCHIVE_MAINTENANCE.maxPerHeartbeat,
    },
  };
}

/**
 * Resolve sparse level definitions into complete runtime levels, omitting explicitly removed levels.
 *
 * @param levels - Merged level definitions.
 * @param globalMaxWorkers - Capacity fallback for sparse levels.
 */
function resolveLevels(levels: Readonly<Record<string, LevelOverride | false>>, globalMaxWorkers: number): Record<string, ResolvedLevelConfig> {
  const result: Record<string, ResolvedLevelConfig> = {};

  for (const [level, definition] of Object.entries(levels)) {
    if (definition === false) continue;
    if (definition.rank === undefined || !definition.model) throw new Error(`Cannot resolve incomplete level "${level}".`);
    result[level] = {
      rank: definition.rank,
      model: definition.model,
      maxWorkers: definition.maxWorkers ?? globalMaxWorkers,
      ...(definition.emoji ? { emoji: definition.emoji } : {}),
    };
  }

  return result;
}
