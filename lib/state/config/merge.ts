/**
 * config/merge.ts — Deep merge for DevClaw config layers.
 *
 * Merge semantics:
 * - Objects: recursively merge (sparse override)
 * - Arrays: replace entirely (no merging array elements)
 * - `false` for a role: marks it as disabled
 * - `false` for a level: removes that inherited level during resolution
 * - Primitives: override
 */
import type { DevClawConfig, LevelOverride, RoleOverride, StateOverride } from "./types.js";

/**
 * Merge a config overlay on top of a base config.
 * Returns a new config — does not mutate inputs.
 *
 * @param base - Lower-precedence configuration inherited by the result.
 * @param overlay - Higher-precedence configuration applied over the base.
 */
export function mergeConfig(
  base: DevClawConfig,
  overlay: DevClawConfig,
): DevClawConfig {
  const merged: DevClawConfig = {};

  // Merge roles
  if (base.roles || overlay.roles) {
    merged.roles = { ...base.roles };
    if (overlay.roles) {
      for (const [roleId, overrideValue] of Object.entries(overlay.roles)) {
        if (overrideValue === false) {
          // Disable role
          merged.roles[roleId] = false;
        } else if (merged.roles[roleId] === false) {
          // Re-enable with override
          merged.roles[roleId] = overrideValue;
        } else {
          // Merge role override on top of base role
          const baseRole = merged.roles[roleId];

          merged.roles[roleId] = mergeRoleOverride(
            typeof baseRole === "object" ? baseRole : {},
            overrideValue,
          );
        }
      }
    }
  }

  // Merge workflow
  if (base.workflow || overlay.workflow) {
    merged.workflow = {
      initial: overlay.workflow?.initial ?? base.workflow?.initial,
      reviewPolicy: overlay.workflow?.reviewPolicy ?? base.workflow?.reviewPolicy,
      testPolicy: overlay.workflow?.testPolicy ?? base.workflow?.testPolicy,
      roleExecution: overlay.workflow?.roleExecution ?? base.workflow?.roleExecution,
      maxWorkersPerLevel: overlay.workflow?.maxWorkersPerLevel ?? base.workflow?.maxWorkersPerLevel,
      states: mergeWorkflowStates(
        base.workflow?.states,
        overlay.workflow?.states,
      ),
    };
    // Clean up undefined initial
    if (merged.workflow.initial === undefined) {
      delete merged.workflow.initial;
    }
  }

  // Merge timeouts
  if (base.timeouts || overlay.timeouts) {
    merged.timeouts = { ...base.timeouts, ...overlay.timeouts };
  }

  if (base.issueArchiveMaintenance || overlay.issueArchiveMaintenance) {
    merged.issueArchiveMaintenance = {
      ...base.issueArchiveMaintenance,
      ...overlay.issueArchiveMaintenance,
    };
  }

  return merged;
}

/**
 * Merge workflow-state overrides while combining nested transition maps by event.
 *
 * @param base - State overrides inherited from the lower configuration layer.
 * @param overlay - State overrides supplied by the higher configuration layer.
 */
function mergeWorkflowStates(
  base: Readonly<Record<string, StateOverride>> | undefined,
  overlay: Readonly<Record<string, StateOverride>> | undefined,
): Record<string, StateOverride> | undefined {
  if (!base && !overlay) return undefined;

  const states: Record<string, StateOverride> = { ...base };

  for (const [stateKey, override] of Object.entries(overlay ?? {})) {
    const baseState = states[stateKey];
    const transitions = baseState?.on || override.on
      ? { ...baseState?.on, ...override.on }
      : undefined;

    states[stateKey] = {
      ...baseState,
      ...override,
      ...(transitions ? { on: transitions } : {}),
    };
  }

  return states;
}

/**
 * Merge one role override while combining nested levels and completion mappings.
 *
 * @param base - Role definition inherited from the lower configuration layer.
 * @param overlay - Role changes supplied by the higher configuration layer.
 */
function mergeRoleOverride(
  base: RoleOverride,
  overlay: RoleOverride,
): RoleOverride {
  return {
    ...base,
    ...overlay,
    levels: mergeRoleLevels(base.levels, overlay.levels),
    // Completion mappings merge by result identifier
    completion: base.completion || overlay.completion
      ? { ...base.completion, ...overlay.completion }
      : undefined,
  };
}

/**
 * Merge sparse level definitions while preserving explicit false removals.
 *
 * @param base - Level definitions inherited from the lower configuration layer.
 * @param overlay - Sparse level changes from the higher configuration layer.
 */
function mergeRoleLevels(
  base: Readonly<Record<string, LevelOverride | false>> | undefined,
  overlay: Readonly<Record<string, LevelOverride | false>> | undefined,
): Record<string, LevelOverride | false> | undefined {
  if (!base && !overlay) return undefined;

  const levels: Record<string, LevelOverride | false> = { ...base };

  for (const [level, override] of Object.entries(overlay ?? {})) {
    const inherited = levels[level];

    levels[level] = override === false
      ? false
      : inherited
        ? { ...inherited, ...override }
        : { ...override };
  }

  return levels;
}
