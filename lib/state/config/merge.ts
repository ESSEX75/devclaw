/**
 * config/merge.ts — Deep merge for DevClaw config layers.
 *
 * Merge semantics:
 * - Objects: recursively merge (sparse override)
 * - Arrays: replace entirely (no merging array elements)
 * - `false` for a role: marks it as disabled
 * - Primitives: override
 */
import type { DevClawConfig, RoleOverride, StateOverride } from "./types.js";

/**
 * Merge a config overlay on top of a base config.
 * Returns a new config — does not mutate inputs.
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

  return merged;
}

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

function mergeRoleOverride(
  base: RoleOverride,
  overlay: RoleOverride,
): RoleOverride {
  const levels = overlay.levels ?? base.levels;
  const allowedLevels = levels ? new Set(levels) : undefined;
  const baseModels = allowedLevels
    ? Object.fromEntries(Object.entries(base.models ?? {}).filter(([level]) => allowedLevels.has(level)))
    : base.models;
  const baseEmoji = allowedLevels
    ? Object.fromEntries(Object.entries(base.emoji ?? {}).filter(([level]) => allowedLevels.has(level)))
    : base.emoji;

  return {
    ...base,
    ...overlay,
    // Models: merge (don't replace)
    models: baseModels || overlay.models
      ? { ...baseModels, ...overlay.models }
      : undefined,
    // Emoji: merge (don't replace)
    emoji: baseEmoji || overlay.emoji
      ? { ...baseEmoji, ...overlay.emoji }
      : undefined,
    // Completion mappings merge by result identifier
    completion: base.completion || overlay.completion
      ? { ...base.completion, ...overlay.completion }
      : undefined,
    // Arrays replace entirely
    ...(overlay.levels ? { levels: overlay.levels } : {}),
  };
}
