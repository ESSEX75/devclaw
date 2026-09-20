/**
 * Strict validation for raw and merged DevClaw workflow configuration.
 */
import { z } from "zod";

import type { WorkflowConfig } from "../../domain/index.js";
import {
  ACTION,
  EXECUTION_MODE,
  REVIEW_CHECK,
  REVIEW_POLICY,
  STATE_TYPE,
  TEST_POLICY,
  type TransitionTarget,
  WORKFLOW_EVENT,
} from "../../domain/index.js";
import type { DevClawConfig } from "./types.js";

/** Pattern accepted for configuration-owned identifiers. */
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** Maximum provider label length accepted by workflow configuration. */
const LABEL_MAX_LENGTH = 50;
/** Pattern accepted for six-digit provider label colors. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Reusable schema for configuration-owned identifiers. */
const IdentifierSchema = z.string()
  .min(1)
  .regex(IDENTIFIER_PATTERN, "must start with a letter and contain only letters, numbers, underscores, or hyphens");
/** Reusable schema for provider-visible workflow labels. */
const LabelSchema = z.string().trim().min(1).max(LABEL_MAX_LENGTH);
/** Reusable schema for provider-visible hexadecimal colors. */
const ColorSchema = z.string().regex(HEX_COLOR_PATTERN, "must be a six-digit hexadecimal color");

/** Strict schema for one event-driven workflow transition target. */
const TransitionTargetSchema = z.object({
  target: IdentifierSchema,
  actions: z.array(z.enum(ACTION)).optional(),
  description: z.string().trim().min(1).optional(),
}).strict();

/** Complete set of workflow event identifiers accepted as transition keys. */
const WORKFLOW_EVENTS: ReadonlySet<string> = new Set(Object.values(WORKFLOW_EVENT));
/** Schema for event-indexed workflow transitions. */
const WorkflowTransitionsSchema = z.record(z.string(), TransitionTargetSchema)
  .superRefine((transitions, context) => {
    for (const event of Object.keys(transitions)) {
      if (!WORKFLOW_EVENTS.has(event)) {
        context.addIssue({
          code: "custom",
          path: [event],
          message: `unknown workflow event "${event}"`,
        });
      }
    }
  });

/** Fields shared by non-terminal workflow states. */
const StatefulFields = {
  label: LabelSchema,
  color: ColorSchema,
  description: z.string().trim().min(1).optional(),
  check: z.enum(REVIEW_CHECK).optional(),
  on: WorkflowTransitionsSchema.optional(),
};

/** Strict schema for a queue workflow state. */
const QueueStateSchema = z.object({
  ...StatefulFields,
  type: z.literal(STATE_TYPE.QUEUE),
  role: IdentifierSchema,
  priority: z.number().int().optional(),
}).strict();

/** Strict schema for an active workflow state. */
const ActiveStateSchema = z.object({
  ...StatefulFields,
  type: z.literal(STATE_TYPE.ACTIVE),
  role: IdentifierSchema,
}).strict();

/** Strict schema for a hold workflow state. */
const HoldStateSchema = z.object({
  ...StatefulFields,
  type: z.literal(STATE_TYPE.HOLD),
}).strict();

/** Strict schema for a terminal workflow state. */
const TerminalStateSchema = z.object({
  label: LabelSchema,
  color: ColorSchema,
  description: z.string().trim().min(1).optional(),
  check: z.enum(REVIEW_CHECK).optional(),
  type: z.literal(STATE_TYPE.TERMINAL),
}).strict();

/** Discriminated schema for a fully resolved workflow state. */
const StateConfigSchema = z.discriminatedUnion("type", [
  QueueStateSchema,
  ActiveStateSchema,
  HoldStateSchema,
  TerminalStateSchema,
]);

/** Strict schema for one sparse workflow-state override. */
const StateOverrideSchema = z.object({
  type: z.enum(STATE_TYPE).optional(),
  role: IdentifierSchema.optional(),
  label: LabelSchema.optional(),
  color: ColorSchema.optional(),
  description: z.string().trim().min(1).optional(),
  check: z.enum(REVIEW_CHECK).optional(),
  priority: z.number().int().optional(),
  on: WorkflowTransitionsSchema.optional(),
}).strict();

/** Strict schema for one sparse workflow configuration layer. */
const WorkflowConfigSchema = z.object({
  initial: IdentifierSchema.optional(),
  reviewPolicy: z.enum(REVIEW_POLICY).optional(),
  testPolicy: z.enum(TEST_POLICY).optional(),
  roleExecution: z.enum(EXECUTION_MODE).optional(),
  maxWorkersPerLevel: z.number().int().positive().optional(),
  states: z.record(IdentifierSchema, StateOverrideSchema).optional(),
}).strict();

/** Strict schema for the fully resolved workflow contract. */
const ResolvedWorkflowConfigSchema = z.object({
  initial: IdentifierSchema,
  reviewPolicy: z.enum(REVIEW_POLICY).optional(),
  testPolicy: z.enum(TEST_POLICY).optional(),
  roleExecution: z.enum(EXECUTION_MODE).optional(),
  maxWorkersPerLevel: z.number().int().positive().optional(),
  states: z.record(IdentifierSchema, StateConfigSchema),
}).strict();

/** Strict schema for one removable or sparse role-level override. */
const LevelOverrideSchema = z.union([
  z.literal(false),
  z.object({
    rank: z.number().int().positive().optional(),
    model: z.string().trim().min(1).optional(),
    maxWorkers: z.number().int().positive().optional(),
    emoji: z.string().min(1).optional(),
  }).strict(),
]);

/** Strict schema for one disabled or sparse role override. */
const RoleOverrideSchema = z.union([
  z.literal(false),
  z.object({
    enabled: z.boolean().optional(),
    levels: z.record(IdentifierSchema, LevelOverrideSchema).optional(),
    defaultLevel: IdentifierSchema.optional(),
    completion: z.record(IdentifierSchema, z.enum(WORKFLOW_EVENT)).optional(),
  }).strict(),
]);

/** Strict optional schema for runtime timeout overrides. */
const TimeoutConfigSchema = z.object({
  gitPullMs: z.number().positive().optional(),
  gatewayMs: z.number().positive().optional(),
  sessionPatchMs: z.number().positive().optional(),
  dispatchMs: z.number().positive().optional(),
  staleWorkerHours: z.number().positive().optional(),
  sessionContextBudget: z.number().min(0).max(1).optional(),
  stallTimeoutMinutes: z.number().positive().optional(),
}).strict().optional();

/** Strict optional schema for instance identity configuration. */
const InstanceConfigSchema = z.object({
  name: z.string().trim().min(1).optional(),
}).strict().optional();

/** Schema for bounded duration strings accepted by archive maintenance. */
const DurationSchema = z.string().regex(/^\d+(?:ms|s|m|h|d)$/, "must be a duration such as 90d, 12h, or 0d");
/** Strict optional schema for archive retention and heartbeat limits. */
const IssueArchiveMaintenanceSchema = z.object({
  deletedProviderRetention: DurationSchema.optional(),
  archiveRetention: DurationSchema.optional(),
  attachmentsRetention: DurationSchema.optional(),
  maxPerHeartbeat: z.number().int().min(1).max(1000).optional(),
}).strict().optional();

/** Strict schema for the complete current raw configuration document. */
const DevClawConfigSchema = z.object({
  roles: z.record(IdentifierSchema, RoleOverrideSchema).optional(),
  workflow: WorkflowConfigSchema.optional(),
  timeouts: TimeoutConfigSchema,
  instance: InstanceConfigSchema,
  issueArchiveMaintenance: IssueArchiveMaintenanceSchema,
}).strict();

/**
 * Parse unknown input into the strict current raw configuration model.
 *
 * @param raw - Untrusted value obtained from a configuration boundary.
 */
export function parseConfig(raw: unknown): DevClawConfig {
  return DevClawConfigSchema.parse(raw);
}

/**
 * Parse the complete workflow shape after all configuration layers merge.
 *
 * @param workflow - Merged workflow candidate that must satisfy the resolved contract.
 */
export function parseResolvedWorkflowConfig(workflow: unknown): WorkflowConfig {
  return ResolvedWorkflowConfigSchema.parse(workflow);
}

/** Minimal level contract required for cross-reference integrity validation. */
type RoleIntegrityLevelInput = {
  /** Relative capability rank that must be present and unique within the role. */
  rank?: number;
  /** Model identifier required for an active level. */
  model?: string;
  /** Optional concurrency override retained for structural compatibility. */
  maxWorkers?: number;
  /** Optional announcement emoji retained for structural compatibility. */
  emoji?: string;
};

/** Role definitions accepted by post-merge integrity validation. */
type RoleIntegrityInput = Record<string, false | {
  /** Whether orchestration may dispatch to the role. */
  enabled?: boolean;
  /** Complete or removed levels keyed by configured identifier. */
  levels?: Readonly<Record<string, false | RoleIntegrityLevelInput>>;
  /** Level selected when no explicit complexity signal exists. */
  defaultLevel?: string;
  /** Completion results mapped to workflow events. */
  completion?: Readonly<Record<string, string>>;
}>;

/**
 * Validate completeness and cross-field invariants after all role layers are merged.
 *
 * @param roles - Merged role definitions to inspect for runtime completeness.
 * @param builtInRoleIds - Built-in role identifiers that may be explicitly disabled.
 */
export function validateRoleIntegrity(
  roles: RoleIntegrityInput,
  builtInRoleIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];

  for (const [roleId, role] of Object.entries(roles)) {
    const rolePath = `roles.${roleId}`;

    if (role === false) {
      if (!builtInRoleIds.has(roleId)) {
        errors.push(`${rolePath}: a custom role cannot be declared as false`);
      }

      continue;
    }

    const activeLevels: Array<[string, RoleIntegrityLevelInput]> = [];

    for (const [level, definition] of Object.entries(role.levels ?? {})) {
      if (definition !== false) activeLevels.push([level, definition]);
    }

    if (activeLevels.length === 0) {
      errors.push(`${rolePath}.levels: at least one level is required`);
      continue;
    }

    const levels = new Set(activeLevels.map(([level]) => level));
    const seenRanks = new Map<number, string>();

    for (const [level, definition] of activeLevels) {
      if (definition.rank === undefined) {
        errors.push(`${rolePath}.levels.${level}.rank: is required`);
      } else {
        const existingLevel = seenRanks.get(definition.rank);

        if (existingLevel) {
          errors.push(`${rolePath}.levels.${level}.rank: rank ${definition.rank} is already used by level "${existingLevel}"`);
        } else {
          seenRanks.set(definition.rank, level);
        }
      }

      if (!definition.model) {
        errors.push(`${rolePath}.levels.${level}.model: is required`);
      }
    }

    if (!role.defaultLevel) {
      errors.push(`${rolePath}.defaultLevel: is required`);
    } else if (!levels.has(role.defaultLevel)) {
      errors.push(`${rolePath}.defaultLevel: "${role.defaultLevel}" is not listed in levels`);
    }

    if (!role.completion || Object.keys(role.completion).length === 0) {
      errors.push(`${rolePath}.completion: at least one result mapping is required`);
    }
  }

  return errors;
}

/**
 * Check whether a provider label uses a routing format reserved by DevClaw.
 *
 * @param label - Provider-visible label to examine.
 */
function isReservedLabel(label: string): boolean {
  const normalized = label.toLowerCase();

  return normalized.startsWith("owner:")
    || normalized.startsWith("notify:")
    || /^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z][A-Za-z0-9_-]*$/.test(label);
}

/**
 * Validate workflow references, label uniqueness, and reserved routing formats after merging.
 *
 * @param workflow - Fully shaped workflow whose semantic references must be consistent.
 * @param configuredRoleIds - Role identifiers available to actionable workflow states.
 */
export function validateWorkflowIntegrity(
  workflow: {
    /** State selected when a managed issue first enters the workflow. */
    initial: string;
    /** Complete workflow states keyed by configured state identifier. */
    states: Record<string, {
      /** State category controlling its runtime semantics. */
      type: string;
      /** Provider-visible label corresponding to the state. */
      label: string;
      /** Optional configured role responsible for actionable states. */
      role?: string;
      /** Optional transitions keyed by workflow event. */
      on?: Record<string, TransitionTarget<string>>;
    }>;
  },
  configuredRoleIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  const stateKeys = new Set(Object.keys(workflow.states));
  const labels = new Map<string, string>();

  if (!stateKeys.has(workflow.initial)) {
    errors.push(`workflow.initial: state "${workflow.initial}" does not exist`);
  }

  for (const [key, state] of Object.entries(workflow.states)) {
    const statePath = `workflow.states.${key}`;
    const existingState = labels.get(state.label);

    if (existingState) {
      errors.push(`${statePath}.label: duplicates label used by workflow.states.${existingState}`);
    } else {
      labels.set(state.label, key);
    }

    if (isReservedLabel(state.label)) {
      errors.push(`${statePath}.label: "${state.label}" uses a reserved routing-label format`);
    }

    if (
      (state.type === STATE_TYPE.QUEUE || state.type === STATE_TYPE.ACTIVE)
      && state.role
      && !configuredRoleIds.has(state.role)
    ) {
      errors.push(`${statePath}.role: role "${state.role}" is not configured`);
    }

    if (state.on) {
      for (const [event, transition] of Object.entries(state.on)) {
        if (!stateKeys.has(transition.target)) {
          errors.push(`${statePath}.on.${event}.target: state "${transition.target}" does not exist`);
        }
      }
    }
  }

  return errors;
}
