/**
 * Strict validation for raw and merged DevClaw workflow configuration.
 */
import { z } from "zod";

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

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const LABEL_MAX_LENGTH = 50;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const IdentifierSchema = z.string()
  .min(1)
  .regex(IDENTIFIER_PATTERN, "must start with a letter and contain only letters, numbers, underscores, or hyphens");
const LabelSchema = z.string().trim().min(1).max(LABEL_MAX_LENGTH);
const ColorSchema = z.string().regex(HEX_COLOR_PATTERN, "must be a six-digit hexadecimal color");

const TransitionTargetSchema = z.object({
  target: IdentifierSchema,
  actions: z.array(z.enum(ACTION)).optional(),
  description: z.string().trim().min(1).optional(),
}).strict();

const WORKFLOW_EVENTS: ReadonlySet<string> = new Set(Object.values(WORKFLOW_EVENT));
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

const StatefulFields = {
  label: LabelSchema,
  color: ColorSchema,
  description: z.string().trim().min(1).optional(),
  check: z.enum(REVIEW_CHECK).optional(),
  on: WorkflowTransitionsSchema.optional(),
};

const QueueStateSchema = z.object({
  ...StatefulFields,
  type: z.literal(STATE_TYPE.QUEUE),
  role: IdentifierSchema,
  priority: z.number().int().optional(),
}).strict();

const ActiveStateSchema = z.object({
  ...StatefulFields,
  type: z.literal(STATE_TYPE.ACTIVE),
  role: IdentifierSchema,
}).strict();

const HoldStateSchema = z.object({
  ...StatefulFields,
  type: z.literal(STATE_TYPE.HOLD),
}).strict();

const TerminalStateSchema = z.object({
  label: LabelSchema,
  color: ColorSchema,
  description: z.string().trim().min(1).optional(),
  check: z.enum(REVIEW_CHECK).optional(),
  type: z.literal(STATE_TYPE.TERMINAL),
}).strict();

const StateConfigSchema = z.discriminatedUnion("type", [
  QueueStateSchema,
  ActiveStateSchema,
  HoldStateSchema,
  TerminalStateSchema,
]);

const WorkflowConfigSchema = z.object({
  initial: IdentifierSchema.optional(),
  reviewPolicy: z.enum(REVIEW_POLICY).optional(),
  testPolicy: z.enum(TEST_POLICY).optional(),
  roleExecution: z.enum(EXECUTION_MODE).optional(),
  maxWorkersPerLevel: z.number().int().positive().optional(),
  states: z.record(IdentifierSchema, StateConfigSchema).optional(),
}).strict();

const ModelEntrySchema = z.union([
  z.string().trim().min(1),
  z.object({
    model: z.string().trim().min(1),
    maxWorkers: z.number().int().positive().optional(),
  }).strict(),
]);

const RoleOverrideSchema = z.union([
  z.literal(false),
  z.object({
    enabled: z.boolean().optional(),
    levels: z.array(IdentifierSchema).min(1).optional(),
    defaultLevel: IdentifierSchema.optional(),
    models: z.record(IdentifierSchema, ModelEntrySchema).optional(),
    emoji: z.record(IdentifierSchema, z.string().min(1)).optional(),
    completion: z.record(IdentifierSchema, z.enum(WORKFLOW_EVENT)).optional(),
  }).strict(),
]);

const TimeoutConfigSchema = z.object({
  gitPullMs: z.number().positive().optional(),
  gatewayMs: z.number().positive().optional(),
  sessionPatchMs: z.number().positive().optional(),
  dispatchMs: z.number().positive().optional(),
  staleWorkerHours: z.number().positive().optional(),
  sessionContextBudget: z.number().min(0).max(1).optional(),
  stallTimeoutMinutes: z.number().positive().optional(),
}).strict().optional();

const InstanceConfigSchema = z.object({
  name: z.string().trim().min(1).optional(),
}).strict().optional();

export const DevClawConfigSchema = z.object({
  roles: z.record(IdentifierSchema, RoleOverrideSchema).optional(),
  workflow: WorkflowConfigSchema.optional(),
  timeouts: TimeoutConfigSchema,
  instance: InstanceConfigSchema,
}).strict();

/** Validate raw parsed YAML and throw a path-aware Zod error on failure. */
export function validateConfig(raw: unknown): void {
  DevClawConfigSchema.parse(raw);
}

type RoleIntegrityInput = Record<string, false | {
  enabled?: boolean;
  levels?: readonly string[];
  defaultLevel?: string;
  models?: Readonly<Record<string, unknown>>;
  emoji?: Readonly<Record<string, string>>;
  completion?: Readonly<Record<string, string>>;
}>;

/** Validate complete role definitions after all configuration layers are merged. */
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

    if (!role.levels?.length) {
      errors.push(`${rolePath}.levels: at least one level is required`);
      continue;
    }

    const levels = new Set(role.levels);

    if (!role.defaultLevel) {
      errors.push(`${rolePath}.defaultLevel: is required`);
    } else if (!levels.has(role.defaultLevel)) {
      errors.push(`${rolePath}.defaultLevel: "${role.defaultLevel}" is not listed in levels`);
    }

    if (!role.models) {
      errors.push(`${rolePath}.models: is required`);
    } else {
      for (const level of role.levels) {
        if (!(level in role.models)) {
          errors.push(`${rolePath}.models.${level}: a model is required for every configured level`);
        }
      }

      for (const level of Object.keys(role.models)) {
        if (!levels.has(level)) {
          errors.push(`${rolePath}.models.${level}: level is not listed in ${rolePath}.levels`);
        }
      }
    }

    for (const level of Object.keys(role.emoji ?? {})) {
      if (!levels.has(level)) {
        errors.push(`${rolePath}.emoji.${level}: level is not listed in ${rolePath}.levels`);
      }
    }

    if (!role.completion || Object.keys(role.completion).length === 0) {
      errors.push(`${rolePath}.completion: at least one result mapping is required`);
    }
  }

  return errors;
}

function isReservedLabel(label: string): boolean {
  const normalized = label.toLowerCase();

  return normalized.startsWith("owner:")
    || normalized.startsWith("notify:")
    || /^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z][A-Za-z0-9_-]*$/.test(label);
}

/** Validate references and invariants after all configuration layers are merged. */
export function validateWorkflowIntegrity(
  workflow: {
    initial: string;
    states: Record<string, {
      type: string;
      label: string;
      role?: string;
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
