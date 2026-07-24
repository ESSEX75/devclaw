/**
 * roles/selectors.ts — Query helpers for the role registry.
 *
 * All role-related lookups go through these functions.
 * No other file should access ROLE_REGISTRY directly for role logic.
 */
import { isLevelId, isRoleId, type LevelId, type RoleId } from "../domain/index.js";
import type { ResolvedRoleConfig } from "../state/config/types.js";
import { ROLE_REGISTRY } from "./registry.js";
import type { RoleConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Role IDs
// ---------------------------------------------------------------------------

/** All registered role IDs. */
export function getAllRoleIds(): RoleId[] {
  return Object.values(ROLE_REGISTRY).map((config) => config.id);
}

/** The role ID union type, derived from registry. */
export type WorkerRole = keyof typeof ROLE_REGISTRY;

/** Check if a string is a valid role ID. */
export function isValidRole(role: string): role is RoleId {
  return isRoleId(role);
}

/** Get role config by ID. Returns undefined if not found. */
export function getRole(role: string): RoleConfig | undefined {
  return isValidRole(role) ? ROLE_REGISTRY[role] : undefined;
}

/** Get role config by ID. Throws if not found. */
export function requireRole(role: string): RoleConfig {
  const config = getRole(role);

  if (!config) throw new Error(`Unknown role: "${role}". Valid roles: ${getAllRoleIds().join(", ")}`);

  return config;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** Get valid levels for a role. */
export function getLevelsForRole(role: string): readonly LevelId[] {
  return getRole(role)?.levels ?? [];
}

/** Get all levels across all roles. */
export function getAllLevels(): LevelId[] {
  return Object.values(ROLE_REGISTRY).flatMap(r => [...r.levels]);
}

/** Check if a level belongs to a specific role. */
export function isLevelForRole(level: string, role: string): boolean {
  return isLevelId(level) && getLevelsForRole(role).includes(level);
}

/** Determine which role a level belongs to. Returns undefined if no match. */
export function roleForLevel(level: string): RoleId | undefined {
  if (!isLevelId(level)) return undefined;

  for (const roleId of getAllRoleIds()) {
    if (ROLE_REGISTRY[roleId].levels.includes(level)) return roleId;
  }

  return undefined;
}

export function canonicalRole(role: string): RoleId | undefined {
  return isValidRole(role) ? role : undefined;
}

export function canonicalLevel(_role: string, level: string): LevelId | undefined {
  return isLevelId(level) ? level : undefined;
}

/** Get the default level for a role. */
export function getDefaultLevel(role: string): LevelId | undefined {
  return getRole(role)?.defaultLevel;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Get default model for a role + level. */
export function getDefaultModel(role: string, level: string): string | undefined {
  return isLevelId(level) ? getRole(role)?.models[level] : undefined;
}

/** Get all default models, nested by role (for config schema). */
export function getAllDefaultModels(): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};

  for (const roleId of getAllRoleIds()) {
    const config = ROLE_REGISTRY[roleId];

    result[roleId] = { ...config.models };
  }

  return result;
}

/**
 * Resolve a level to a full model ID.
 *
 * Resolution order:
 * 1. Resolved config from workflow.yaml (three-layer merge)
 * 2. Registry default model
 * 3. Passthrough (treat level as raw model ID)
 */
export function resolveModel(
  role: string,
  level: string,
  resolvedRole?: ResolvedRoleConfig,
): string {
  const canonical = canonicalLevel(role, level);

  // 1. Resolved config (workflow.yaml — includes workspace + project overrides)
  if (canonical && resolvedRole?.models[canonical]) return resolvedRole.models[canonical];

  // 2. Built-in registry default
  return canonical ? getDefaultModel(role, canonical) ?? canonical : level;
}

// ---------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------

/** Get emoji for a role + level. */
export function getEmoji(role: string, level: string): string | undefined {
  return isLevelId(level) ? getRole(role)?.emoji[level] : undefined;
}

/** Get fallback emoji for a role. */
export function getFallbackEmoji(role: string): string {
  return getRole(role)?.fallbackEmoji ?? "📋";
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/** Get valid completion results for a role. */
export function getCompletionResults(role: string): readonly string[] {
  return getRole(role)?.completionResults ?? [];
}

/** Check if a result is valid for a role. */
export function isValidResult(role: string, result: string): boolean {
  return getCompletionResults(role).includes(result);
}

// ---------------------------------------------------------------------------
// Session keys
// ---------------------------------------------------------------------------

/** Build regex pattern that matches any registered role in session keys. */
export function getSessionKeyRolePattern(): string {
  return Object.values(ROLE_REGISTRY).map(r => r.sessionKeyPattern).join("|");
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Check if a role has a specific notification enabled. */
export function isNotificationEnabled(
  role: string,
  event: "onStart" | "onComplete",
): boolean {
  return getRole(role)?.notifications[event] ?? true;
}
