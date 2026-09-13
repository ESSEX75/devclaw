/**
 * config/loader.ts — Three-layer config loading.
 *
 * Resolution order:
 *   1. Built-in defaults (ROLE_REGISTRY + DEFAULT_WORKFLOW)
 *   2. Workspace: <workspace>/devclaw/workflow.yaml
 *   3. Project:   <workspace>/devclaw/projects/<project>/workflow.yaml
 *
 */
import fs from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";
import { ZodError } from "zod";

import { DEFAULT_WORKFLOW, isBuiltInRoleId } from "../../domain/index.js";
import { getAllRoleIds, ROLE_REGISTRY } from "../../roles/index.js";
import { DATA_DIR } from "../paths.js";
import { mergeConfig } from "./merge.js";
import { parseConfig, parseResolvedWorkflowConfig, validateRoleIntegrity, validateWorkflowIntegrity } from "./schema.js";
import type {
  DevClawConfig,
  LevelOverride,
  ResolvedConfig,
  ResolvedLevelConfig,
  ResolvedRoleConfig,
  ResolvedTimeouts,
  RoleOverride,
} from "./types.js";

/**
 * Load and resolve the full DevClaw config for a project.
 *
 * Merges: built-in → workspace workflow.yaml → project workflow.yaml.
 */
export async function loadConfig(
  workspaceDir: string,
  projectName?: string,
): Promise<ResolvedConfig> {
  const dataDir = path.join(workspaceDir, DATA_DIR);
  const projectsDir = path.join(dataDir, "projects");

  // Layer 1: built-in defaults
  const builtIn = buildDefaultConfig();

  // Layer 2: workspace workflow.yaml (in devclaw/ data dir)
  let merged = builtIn;
  const workspaceConfig = await readWorkflowFile(dataDir);

  if (workspaceConfig) {
    merged = mergeConfig(merged, workspaceConfig);
  }

  // Layer 3: project workflow.yaml
  if (projectName) {
    const projectDir = path.join(projectsDir, projectName);
    const projectConfig = await readWorkflowFile(projectDir);

    if (projectConfig) {
      merged = mergeConfig(merged, projectConfig);
    }
  }

  return resolve(merged);
}

/**
 * Build the default config from the built-in ROLE_REGISTRY and DEFAULT_WORKFLOW.
 */
function buildDefaultConfig(): DevClawConfig {
  const roles: Record<string, RoleOverride> = {};

  for (const id of getAllRoleIds()) {
    const reg = ROLE_REGISTRY[id];

    roles[id] = {
      levels: copyBuiltInLevels(reg.levels),
      defaultLevel: reg.defaultLevel,
      completion: { ...reg.completion },
    };
  }

  return { roles, workflow: DEFAULT_WORKFLOW };
}

/**
 * Resolve a merged DevClawConfig into a fully-typed ResolvedConfig.
 */
/** Default max workers per level when no override is set. */
const DEFAULT_MAX_WORKERS_PER_LEVEL = 2;

/**
 * Copy built-in level definitions into the mutable raw configuration model.
 *
 * @param levels - Registry-owned built-in level definitions.
 */
function copyBuiltInLevels(
  levels: Readonly<Record<string, LevelOverride | undefined>>,
): Record<string, LevelOverride> {
  const result: Record<string, LevelOverride> = {};

  for (const [level, definition] of Object.entries(levels)) {
    if (definition) result[level] = { ...definition };
  }

  return result;
}

/**
 * Convert validated merged level definitions into complete runtime configuration.
 *
 * @param levels - Merged level definitions after schema and integrity validation.
 * @param globalMaxWorkers - Fallback concurrency used when a level omits an override.
 */
function resolveLevels(
  levels: Readonly<Record<string, LevelOverride | false>>,
  globalMaxWorkers: number,
): Record<string, ResolvedLevelConfig> {
  const result: Record<string, ResolvedLevelConfig> = {};

  for (const [level, definition] of Object.entries(levels)) {
    if (definition === false) continue;
    if (definition.rank === undefined || !definition.model) {
      throw new Error(`Cannot resolve incomplete level "${level}".`);
    }

    result[level] = {
      rank: definition.rank,
      model: definition.model,
      maxWorkers: definition.maxWorkers ?? globalMaxWorkers,
      ...(definition.emoji ? { emoji: definition.emoji } : {}),
    };
  }

  return result;
}

function resolve(config: DevClawConfig): ResolvedConfig {
  const roles: Record<string, ResolvedRoleConfig> = {};
  const globalMaxWorkers = config.workflow?.maxWorkersPerLevel ?? DEFAULT_MAX_WORKERS_PER_LEVEL;
  const roleIntegrityErrors = validateRoleIntegrity(
    config.roles ?? {},
    new Set(getAllRoleIds()),
  );

  if (roleIntegrityErrors.length > 0) {
    throw new Error(`Role config integrity errors:\n  - ${roleIntegrityErrors.join("\n  - ")}`);
  }

  if (config.roles) {
    for (const [id, override] of Object.entries(config.roles)) {
      if (isBuiltInRoleId(id) && override === false) {
        const reg = ROLE_REGISTRY[id];

        roles[id] = {
          levels: resolveLevels(copyBuiltInLevels(reg.levels), globalMaxWorkers),
          defaultLevel: reg.defaultLevel,
          completion: { ...reg.completion },
          enabled: false,
        };
        continue;
      }

      if (override === false) continue;

      if (isBuiltInRoleId(id)) {
        const reg = ROLE_REGISTRY[id];

        roles[id] = {
          levels: resolveLevels(override.levels ?? copyBuiltInLevels(reg.levels), globalMaxWorkers),
          defaultLevel: override.defaultLevel ?? reg.defaultLevel,
          completion: { ...(override.completion ?? reg.completion) },
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
  }

  // Ensure all built-in roles exist even if not in config
  for (const id of getAllRoleIds()) {
    const reg = ROLE_REGISTRY[id];

    if (!roles[id]) {
      roles[id] = {
        levels: resolveLevels(copyBuiltInLevels(reg.levels), globalMaxWorkers),
        defaultLevel: reg.defaultLevel,
        completion: { ...reg.completion },
        enabled: true,
      };
    }
  }

  const workflow = parseResolvedWorkflowConfig({
    initial: config.workflow?.initial ?? DEFAULT_WORKFLOW.initial,
    reviewPolicy: config.workflow?.reviewPolicy ?? DEFAULT_WORKFLOW.reviewPolicy,
    testPolicy: config.workflow?.testPolicy ?? DEFAULT_WORKFLOW.testPolicy,
    roleExecution: config.workflow?.roleExecution ?? DEFAULT_WORKFLOW.roleExecution,
    maxWorkersPerLevel: globalMaxWorkers,
    states: config.workflow?.states ?? DEFAULT_WORKFLOW.states,
  });

  // Validate structural integrity (cross-references between states)
  const integrityErrors = validateWorkflowIntegrity(workflow, new Set(Object.keys(roles)));

  if (integrityErrors.length > 0) {
    throw new Error(`Workflow config integrity errors:\n  - ${integrityErrors.join("\n  - ")}`);
  }

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
    roles, workflow, timeouts,
    instanceName: config.instance?.name,
    issueArchiveMaintenance: {
      deletedProviderRetention: config.issueArchiveMaintenance?.deletedProviderRetention ?? "90d",
      archiveRetention: config.issueArchiveMaintenance?.archiveRetention ?? "365d",
      attachmentsRetention: config.issueArchiveMaintenance?.attachmentsRetention ?? "90d",
      maxPerHeartbeat: config.issueArchiveMaintenance?.maxPerHeartbeat ?? 100,
    },
  };
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

/** Read workflow.yaml (new primary config file). Validates structure via Zod. */
async function readWorkflowFile(dir: string): Promise<DevClawConfig | null> {
  try {
    const content = await fs.readFile(path.join(dir, "workflow.yaml"), "utf-8");
    const parsed: unknown = YAML.parse(content);

    if (parsed === null || parsed === undefined) return null;

    return parseConfig(parsed);
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return null;
    // Re-throw validation errors with file context
    if (err instanceof ZodError) {
      throw new Error(`Invalid workflow.yaml in ${dir}: ${err.message}`, { cause: err });
    }

    const message = err instanceof Error ? err.message : String(err);

    throw new Error(`Cannot read workflow.yaml in ${dir}: ${message}`, { cause: err });
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
