/** Resolves validated merged configuration into application-facing runtime contracts. */
import { DEFAULT_WORKFLOW, isBuiltInRoleId } from "../../domain/index.js";
import { getAllRoleIds, requireRole } from "../../roles/index.js";
import { copyBuiltInLevels } from "./defaults.js";
import { parseResolvedWorkflowConfig, validateRoleIntegrity, validateWorkflowIntegrity } from "./schema.js";
import type { DevClawConfig, LevelOverride, ResolvedConfig, ResolvedLevelConfig, ResolvedRoleConfig, ResolvedTimeouts } from "./types.js";

const DEFAULT_MAX_WORKERS_PER_LEVEL = 2;

/** @param config - Validated result of the layered merge. */
export function resolveConfig(config: DevClawConfig): ResolvedConfig {
  const roles: Record<string, ResolvedRoleConfig> = {};
  const globalMaxWorkers = config.workflow?.maxWorkersPerLevel ?? DEFAULT_MAX_WORKERS_PER_LEVEL;
  const roleErrors = validateRoleIntegrity(config.roles ?? {}, new Set(getAllRoleIds()));

  if (roleErrors.length > 0) throw new Error(`Role config integrity errors:\n  - ${roleErrors.join("\n  - ")}`);

  for (const [id, override] of Object.entries(config.roles ?? {})) {
    if (isBuiltInRoleId(id) && override === false) {
      roles[id] = resolveBuiltInRole(requireRole(id), globalMaxWorkers, false);
      continue;
    }

    if (override === false) continue;
    if (isBuiltInRoleId(id)) {
      const role = requireRole(id);

      roles[id] = {
        levels: resolveLevels(override.levels ?? copyBuiltInLevels(role.levels), globalMaxWorkers),
        defaultLevel: override.defaultLevel ?? role.defaultLevel,
        completion: { ...(override.completion ?? role.completion) },
        enabled: override.enabled ?? true,
      };
      continue;
    }

    roles[id] = {
      levels: resolveLevels(override.levels ?? {}, globalMaxWorkers),
      defaultLevel: override.defaultLevel ?? "",
      completion: { ...override.completion },
      enabled: override.enabled ?? true,
    };
  }

  for (const id of getAllRoleIds()) if (!roles[id]) roles[id] = resolveBuiltInRole(requireRole(id), globalMaxWorkers, true);

  const workflow = parseResolvedWorkflowConfig({
    initial: config.workflow?.initial ?? DEFAULT_WORKFLOW.initial,
    reviewPolicy: config.workflow?.reviewPolicy ?? DEFAULT_WORKFLOW.reviewPolicy,
    testPolicy: config.workflow?.testPolicy ?? DEFAULT_WORKFLOW.testPolicy,
    roleExecution: config.workflow?.roleExecution ?? DEFAULT_WORKFLOW.roleExecution,
    maxWorkersPerLevel: globalMaxWorkers,
    states: config.workflow?.states ?? DEFAULT_WORKFLOW.states,
  });
  const workflowErrors = validateWorkflowIntegrity(workflow, new Set(Object.keys(roles)));

  if (workflowErrors.length > 0) throw new Error(`Workflow config integrity errors:\n  - ${workflowErrors.join("\n  - ")}`);

  const timeouts: ResolvedTimeouts = {
    gitPullMs: config.timeouts?.gitPullMs ?? 30_000,
    gatewayMs: config.timeouts?.gatewayMs ?? 15_000,
    sessionPatchMs: config.timeouts?.sessionPatchMs ?? 30_000,
    dispatchMs: config.timeouts?.dispatchMs ?? 600_000,
    staleWorkerHours: config.timeouts?.staleWorkerHours ?? 2,
    sessionContextBudget: config.timeouts?.sessionContextBudget ?? 0.6,
    stallTimeoutMinutes: config.timeouts?.stallTimeoutMinutes ?? 15,
  };

  return {
    roles, workflow, timeouts, instanceName: config.instance?.name,
    issueArchiveMaintenance: {
      deletedProviderRetention: config.issueArchiveMaintenance?.deletedProviderRetention ?? "90d",
      archiveRetention: config.issueArchiveMaintenance?.archiveRetention ?? "365d",
      attachmentsRetention: config.issueArchiveMaintenance?.attachmentsRetention ?? "90d",
      maxPerHeartbeat: config.issueArchiveMaintenance?.maxPerHeartbeat ?? 100,
    },
  };
}

/**
 * @param role - Built-in role selected through the roles API.
 * @param globalMaxWorkers - Default capacity for its levels.
 * @param enabled - Whether dispatch is enabled.
 */
function resolveBuiltInRole(role: ReturnType<typeof requireRole>, globalMaxWorkers: number, enabled: boolean): ResolvedRoleConfig {
  return { levels: resolveLevels(copyBuiltInLevels(role.levels), globalMaxWorkers), defaultLevel: role.defaultLevel, completion: { ...role.completion }, enabled };
}

/**
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
