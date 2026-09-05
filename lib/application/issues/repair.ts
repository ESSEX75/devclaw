/**
 * Plans and applies deterministic managed-issue repairs for CLI and plugin adapters.
 * The service owns source validation, stale-plan protection, locking, verification, and audit semantics.
 */
import { createHash, randomUUID } from "node:crypto";

import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import {
  findStateKeyByLabel,
  getStateLabels,
  isNotificationChannel,
  isReviewPolicy,
  ISSUE_INTEGRITY_STATUS,
  type IssueIntegrityStatus,
  type IssueRuntimeState,
  isTestPolicy,
  NOTIFY_LABEL_PREFIX,
  type NotifyBindingRef,
  OWNER_LABEL_PREFIX,
  type Project,
  type ReviewPolicy,
  type TestPolicy,
  type WorkflowConfig,
} from "../../domain/index.js";
import {
  createProvider,
  isProviderIssueLookupError,
  type Issue,
  type IssueProvider,
  PROVIDER_ISSUE_LOOKUP_ERROR,
  type ProviderRateLimitStatus,
} from "../../integrations/providers/index.js";
import {
  diffIssueProjection,
  expectedManagedLabels,
  extractIssueMetadata,
  metadataMatches,
  type ProjectionDiff,
  type ProjectionMetadata,
  replaceIssueMetadata,
} from "../../projection/index.js";
import { loadConfig, type ResolvedRoleConfig } from "../../state/config/index.js";
import {
  readIssueStateStore,
  updateIssueStateStore,
  withIssueOrchestrationLock,
} from "../../state/issues/index.js";
import { readProjects } from "../../state/projects/index.js";
import { applyManagedLabelDiff } from "../projection/index.js";

/** Authoritative snapshot selected for a repair operation. */
export const ISSUE_REPAIR_SOURCE = {
  LOCAL_STATE: "local-state",
  PROVIDER: "provider",
} as const;

/** Stable repair failure identifiers exposed by every adapter. */
export const ISSUE_REPAIR_ERROR = {
  INVALID_INPUT: "INVALID_INPUT",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  ISSUE_NOT_FOUND: "ISSUE_NOT_FOUND",
  LOCAL_STATE_NOT_FOUND: "LOCAL_STATE_NOT_FOUND",
  SOURCE_INCOMPLETE: "SOURCE_INCOMPLETE",
  SOURCE_AMBIGUOUS: "SOURCE_AMBIGUOUS",
  ISSUE_IDENTITY_MISMATCH: "ISSUE_IDENTITY_MISMATCH",
  ACTIVE_WORKER: "ACTIVE_WORKER",
  PLAN_STALE: "PLAN_STALE",
  RATE_LIMIT_PRECHECK_FAILED: "RATE_LIMIT_PRECHECK_FAILED",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_FORBIDDEN: "PROVIDER_FORBIDDEN",
  PROVIDER_TRANSIENT_ERROR: "PROVIDER_TRANSIENT_ERROR",
  REPAIR_APPLY_FAILED: "REPAIR_APPLY_FAILED",
  REPAIR_VERIFICATION_FAILED: "REPAIR_VERIFICATION_FAILED",
} as const;

/** Supported repair source. */
export type IssueRepairSource = typeof ISSUE_REPAIR_SOURCE[keyof typeof ISSUE_REPAIR_SOURCE];

/** Stable repair failure code. */
export type IssueRepairErrorCode = typeof ISSUE_REPAIR_ERROR[keyof typeof ISSUE_REPAIR_ERROR];

/** One local field change proposed when provider projection is authoritative. */
export type IssueRepairLocalChange = {
  field: "workflowState" | "workflowLabel" | "assignedRole" | "assignedLevel" | "owner" | "reviewPolicy" | "testPolicy" | "notifyTarget";
  before: unknown;
  after: unknown;
};

/** Structured application result shared by CLI and plugin tool adapters. */
export type IssueRepairResult = {
  success: boolean;
  mode: "dry_run" | "apply";
  status: "planned" | "repaired" | "already_consistent" | "blocked" | "partial_failure";
  project: string;
  issueId: number;
  source: IssueRepairSource;
  integrityBefore: IssueIntegrityStatus;
  integrityAfter?: IssueIntegrityStatus;
  localSnapshot: IssueRuntimeState;
  providerSnapshot: Issue;
  expectedManagedLabels: string[];
  diffBefore: ProjectionDiff;
  diffAfter?: ProjectionDiff;
  metadataAction: "none" | "replace";
  metadataDiff: {
    actual: ProjectionMetadata | null;
    expected: ProjectionMetadata;
    action: "none" | "replace";
  };
  localChanges: IssueRepairLocalChange[];
  changed: boolean;
  plannedActions: string[];
  appliedActions?: string[];
  warnings: Array<{ code: string; message: string }>;
  estimatedProviderRequests: number;
  rateLimitStatus?: ProviderRateLimitStatus;
  planToken: string;
  auditCorrelationId?: string;
  recoveryPlan?: string[];
  error?: { code: IssueRepairErrorCode; message: string; retryable: boolean; retryAfter?: string };
};

/** Typed repair failure preserved across application, CLI, and plugin boundaries. */
export class IssueRepairFailure extends Error {
  readonly code: IssueRepairErrorCode;
  readonly retryable: boolean;

  constructor(code: IssueRepairErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "IssueRepairFailure";
    this.code = code;
    this.retryable = retryable;
  }
}

/** Check whether a caught value is a stable repair failure. */
export function isIssueRepairFailure(error: unknown): error is IssueRepairFailure {
  return error instanceof IssueRepairFailure;
}

type RepairProvider = IssueProvider;

/** Input accepted by the shared repair use case after adapter-level validation and authorization. */
export type RepairManagedIssueInput = {
  workspaceDir: string;
  projectSlug: string;
  issueId: number;
  source: IssueRepairSource;
  apply?: boolean;
  planToken?: string;
  reason?: string;
  actor: string;
  channelContext?: { channelId?: string; accountId?: string };
  provider?: RepairProvider;
  runCommand: RunCommand;
};

/**
 * Build or apply one repair plan without transitioning workflow state or starting a worker.
 * Apply requires the token returned by a preceding dry-run and revalidates both snapshots under the issue lock.
 */
export async function repairManagedIssue(input: RepairManagedIssueInput): Promise<IssueRepairResult> {
  const context = await resolveRepairContext(input);

  if (!input.apply) {
    const plan = buildRepairPlan(input, context);
    const correlationId = randomUUID();
    const rateLimitStatus = await readRateLimit(context.provider);

    if (!rateLimitStatus && context.provider.getRateLimitStatus) {
      plan.warnings.push({ code: "RATE_LIMIT_PRECHECK_UNAVAILABLE", message: "Provider quota precheck failed without blocking dry-run." });
    }

    await auditRepair(input, "issue_repair_dry_run", correlationId, plan);

    return { ...plan, rateLimitStatus, auditCorrelationId: correlationId };
  }

  return withIssueOrchestrationLock(input.workspaceDir, input.projectSlug, input.issueId, async () => {
    const refreshed = await resolveRepairContext(input);
    const plan = buildRepairPlan(input, refreshed);

    if (!input.planToken || input.planToken !== plan.planToken) {
      return blocked(plan, ISSUE_REPAIR_ERROR.PLAN_STALE, "Repair plan is missing or no longer matches current snapshots.", false);
    }

    if (refreshed.local.activeWorker) {
      return blocked(plan, ISSUE_REPAIR_ERROR.ACTIVE_WORKER, "An active worker owns this issue.", true);
    }

    const quota = await readRateLimit(refreshed.provider);

    if (!quota && refreshed.provider.getRateLimitStatus) {
      plan.warnings.push({ code: "RATE_LIMIT_PRECHECK_UNAVAILABLE", message: "Provider quota precheck failed; apply continues with bounded requests." });
    }

    if (quota && quota.remaining < plan.estimatedProviderRequests) {
      const result = blocked(plan, ISSUE_REPAIR_ERROR.RATE_LIMIT_PRECHECK_FAILED, "Provider quota is below the planned request budget.", true);

      if (result.error && quota.resetAt) result.error.retryAfter = quota.resetAt;

      return result;
    }

    if (!plan.changed) {
      const correlationId = randomUUID();

      await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.OK, []);
      await auditRepair(input, "issue_repair_verified", correlationId, plan);
      await auditRepair(input, "issue_repair_completed", correlationId, plan);

      return {
        ...plan,
        mode: "apply",
        status: "already_consistent",
        integrityAfter: ISSUE_INTEGRITY_STATUS.OK,
        auditCorrelationId: correlationId,
      };
    }

    const correlationId = randomUUID();

    await auditRepair(input, "issue_repair_requested", correlationId, plan);
    await auditRepair(input, "issue_repair_apply_started", correlationId, plan);

    try {
      const appliedActions = input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE
        ? await applyLocalSourceRepair(input, refreshed, plan)
        : await applyProviderSourceRepair(input, refreshed, plan);

      if (input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE) {
        await auditRepair(input, "issue_repair_provider_updated", correlationId, plan);
      }

      const verified = await resolveRepairContext(input);
      const after = buildRepairPlan(input, verified);

      if (after.changed) {
        await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, ["repair verification did not produce a consistent projection"]);
        await auditRepair(input, "issue_repair_partial_failure", correlationId, after);

        return {
          ...after,
          mode: "apply",
          status: "partial_failure",
          appliedActions,
          auditCorrelationId: correlationId,
          error: {
            code: ISSUE_REPAIR_ERROR.REPAIR_VERIFICATION_FAILED,
            message: "Provider verification did not confirm a consistent managed projection.",
            retryable: true,
          },
          recoveryPlan: [
            "Keep local integrity blocked.",
            "Inspect the returned post-apply diff.",
            "Run a new dry-run after provider availability is restored.",
          ],
        };
      }

      await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.OK, []);
      await auditRepair(input, "issue_repair_verified", correlationId, after);
      await auditRepair(input, "issue_repair_completed", correlationId, after);

      return {
        ...after,
        success: true,
        mode: "apply",
        status: "repaired",
        integrityAfter: ISSUE_INTEGRITY_STATUS.OK,
        changed: true,
        appliedActions,
        auditCorrelationId: correlationId,
        diffBefore: plan.diffBefore,
        diffAfter: after.diffBefore,
      };
    } catch (error) {
      const mapped = mapRepairFailure(plan, error);

      await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, [mapped.error?.message ?? "repair apply failed"]);
      await auditRepair(input, "issue_repair_failed", correlationId, mapped);

      return { ...mapped, mode: "apply", status: "partial_failure", auditCorrelationId: correlationId };
    }
  });
}

type RepairContext = {
  project: Project;
  workflow: WorkflowConfig;
  roles: Record<string, ResolvedRoleConfig>;
  local: IssueRuntimeState;
  providerIssue: Issue;
  provider: RepairProvider;
};

async function resolveRepairContext(input: RepairManagedIssueInput): Promise<RepairContext> {
  const projects = await readProjects(input.workspaceDir);
  const project = projects.projects[input.projectSlug];

  if (!project) throw repairFailure(ISSUE_REPAIR_ERROR.PROJECT_NOT_FOUND, `Project "${input.projectSlug}" not found.`);
  const config = await loadConfig(input.workspaceDir, project.name);
  const store = await readIssueStateStore(input.workspaceDir, project.slug);
  const local = store.issues[String(input.issueId)];

  if (!local) throw repairFailure(ISSUE_REPAIR_ERROR.LOCAL_STATE_NOT_FOUND, `Issue #${input.issueId} has no active local state.`);
  const provider = input.provider ?? (await createProvider({
    repo: project.repo,
    provider: project.provider,
    runCommand: input.runCommand,
    workflow: config.workflow,
  })).provider;
  let providerIssue: Issue;

  try {
    providerIssue = await provider.getIssue(input.issueId);
  } catch (error) {
    if (isProviderIssueLookupError(error) && error.code === PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND) {
      throw repairFailure(ISSUE_REPAIR_ERROR.ISSUE_NOT_FOUND, `Provider issue #${input.issueId} was not found.`);
    }

    if (isProviderIssueLookupError(error) && error.code === PROVIDER_ISSUE_LOOKUP_ERROR.RATE_LIMITED) {
      throw repairFailure(ISSUE_REPAIR_ERROR.PROVIDER_RATE_LIMITED, error.message, true);
    }

    if (
      isProviderIssueLookupError(error)
      && (error.code === PROVIDER_ISSUE_LOOKUP_ERROR.UNAUTHORIZED || error.code === PROVIDER_ISSUE_LOOKUP_ERROR.FORBIDDEN)
    ) {
      throw repairFailure(ISSUE_REPAIR_ERROR.PROVIDER_FORBIDDEN, error.message);
    }

    if (isProviderIssueLookupError(error) && error.code === PROVIDER_ISSUE_LOOKUP_ERROR.TRANSIENT) {
      throw repairFailure(ISSUE_REPAIR_ERROR.PROVIDER_TRANSIENT_ERROR, error.message, true);
    }

    if (isProviderIssueLookupError(error) && error.code === PROVIDER_ISSUE_LOOKUP_ERROR.PROJECT_NOT_FOUND_OR_FORBIDDEN) {
      throw repairFailure(ISSUE_REPAIR_ERROR.PROVIDER_FORBIDDEN, error.message);
    }

    if (isProviderIssueLookupError(error)) {
      throw repairFailure(ISSUE_REPAIR_ERROR.REPAIR_APPLY_FAILED, error.message, error.retryable);
    }

    throw error;
  }

  return { project, workflow: config.workflow, roles: config.roles, local, providerIssue, provider };
}

function buildRepairPlan(input: RepairManagedIssueInput, context: RepairContext): IssueRepairResult {
  const state = input.source === ISSUE_REPAIR_SOURCE.PROVIDER
    ? importProviderProjection(context)
    : context.local;
  const localChanges = diffLocalState(context.local, state);
  const stateLabels = getStateLabels(context.workflow);
  const roles = Object.keys(context.roles);
  const diff = diffIssueProjection({ state, actualLabels: context.providerIssue.labels, options: { stateLabels, roles } });
  const expectedMetadata = expectedMetadataFor(state);
  const actualMetadata = extractIssueMetadata(context.providerIssue.description);
  const metadataAction = metadataMatches(actualMetadata, expectedMetadata)
    ? "none"
    : "replace";
  const plannedActions = input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE
    ? [
      ...(diff.missingManagedLabels.length ? ["ensure_managed_labels_exist", "add_missing_managed_labels"] : []),
      ...(diff.unexpectedManagedLabels.length ? ["remove_unexpected_managed_labels"] : []),
      ...(metadataAction === "replace" ? ["replace_managed_metadata"] : []),
      "verify_provider_projection",
    ]
    : [...(localChanges.length ? ["update_allowed_local_fields"] : []), "verify_provider_projection"];
  const changed = diff.missingManagedLabels.length > 0
    || diff.unexpectedManagedLabels.length > 0
    || metadataAction === "replace"
    || localChanges.length > 0;
  const estimatedProviderRequests = input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE
    ? diff.missingManagedLabels.length * 2 + (diff.unexpectedManagedLabels.length ? 1 : 0) + (metadataAction === "replace" ? 1 : 0) + 1
    : 1;
  const tokenPayload = JSON.stringify({
    project: input.projectSlug,
    issueId: input.issueId,
    source: input.source,
    local: context.local,
    provider: { ...context.providerIssue, labels: [...context.providerIssue.labels].sort() },
  });

  return {
    success: true,
    mode: input.apply ? "apply" : "dry_run",
    status: changed ? "planned" : "already_consistent",
    project: input.projectSlug,
    issueId: input.issueId,
    source: input.source,
    integrityBefore: context.local.integrityStatus,
    localSnapshot: context.local,
    providerSnapshot: context.providerIssue,
    expectedManagedLabels: expectedManagedLabels(state),
    diffBefore: diff,
    metadataAction,
    metadataDiff: { actual: actualMetadata, expected: expectedMetadata, action: metadataAction },
    localChanges,
    changed,
    plannedActions,
    warnings: context.provider.getRateLimitStatus ? [] : [{ code: "RATE_LIMIT_STATUS_UNAVAILABLE", message: "Provider does not expose a quota precheck." }],
    estimatedProviderRequests,
    planToken: createHash("sha256").update(tokenPayload).digest("hex"),
  };
}

function importProviderProjection(context: RepairContext): IssueRuntimeState {
  const labels = context.providerIssue.labels;
  const metadata = extractIssueMetadata(context.providerIssue.description);

  if (!metadata) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, "Managed issue metadata is missing or invalid.");
  if (metadata.projectSlug !== context.project.slug || metadata.issueId !== context.local.issueId) {
    throw repairFailure(ISSUE_REPAIR_ERROR.ISSUE_IDENTITY_MISMATCH, "Provider metadata does not match the selected project and issue.");
  }

  if (metadata.projectionVersion !== context.local.projectionVersion) {
    throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, "Provider metadata uses a different projection schema version.");
  }

  const stateLabels = getStateLabels(context.workflow);
  const matchedStates = labels.filter((label) => stateLabels.includes(label));

  if (matchedStates.length === 0) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, "Provider projection has no workflow state label.");
  if (matchedStates.length > 1) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_AMBIGUOUS, "Provider projection has multiple workflow state labels.");
  const workflowLabel = matchedStates[0];
  const workflowState = findStateKeyByLabel(context.workflow, workflowLabel);

  if (!workflowState) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, "Workflow label does not resolve to a state key.");
  const roleLevel = parseSingleRoleLevel(labels, context.roles);
  const owner = parseSinglePrefixedValue(labels, OWNER_LABEL_PREFIX, "owner");
  const reviewPolicy = parseReviewPolicy(labels);
  const testPolicy = parseTestPolicy(labels);
  const notifyTarget = parseNotifyTarget(labels, context.project);

  return {
    ...context.local,
    workflowState,
    workflowLabel,
    assignedRole: roleLevel?.role ?? null,
    assignedLevel: roleLevel?.level ?? null,
    owner,
    reviewPolicy,
    testPolicy,
    notifyTarget,
    projectionVersion: context.local.projectionVersion,
  };
}

function parseSingleRoleLevel(labels: string[], roles: Record<string, ResolvedRoleConfig>): { role: string; level: string } | null {
  const matches: Array<{ role: string; level: string }> = [];

  for (const label of labels) {
    const separator = label.indexOf(":");

    if (separator <= 0) continue;
    const role = label.slice(0, separator);
    const level = label.slice(separator + 1);
    const roleConfig = roles[role];

    if (!roleConfig) continue;
    if (!roleConfig.levels.includes(level)) {
      throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, `Role "${role}" does not define level "${level}".`);
    }

    matches.push({ role, level });
  }

  if (matches.length > 1) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_AMBIGUOUS, "Provider projection has multiple role/level labels.");

  return matches[0] ?? null;
}

function parseSinglePrefixedValue(labels: string[], prefix: string, field: string): string | null {
  const values = labels.filter((label) => label.startsWith(prefix)).map((label) => label.slice(prefix.length)).filter(Boolean);

  if (values.length > 1) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_AMBIGUOUS, `Provider projection has multiple ${field} labels.`);

  return values[0] ?? null;
}

function parseReviewPolicy(labels: string[]): ReviewPolicy | null {
  const value = parseSinglePrefixedValue(labels, "review:", "review policy");

  if (value === null) return null;
  if (!isReviewPolicy(value)) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, `Unknown review policy "${value}".`);

  return value;
}

function parseTestPolicy(labels: string[]): TestPolicy | null {
  const value = parseSinglePrefixedValue(labels, "test:", "test policy");

  if (value === null) return null;
  if (!isTestPolicy(value)) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, `Unknown test policy "${value}".`);

  return value;
}

function parseNotifyTarget(labels: string[], project: Project): NotifyBindingRef | null {
  const value = parseSinglePrefixedValue(labels, NOTIFY_LABEL_PREFIX, "notification binding");

  if (value === null) return null;
  const separator = value.indexOf(":");
  const channel = separator > 0 ? value.slice(0, separator) : "";
  const name = separator > 0 ? value.slice(separator + 1) : "";

  if (!isNotificationChannel(channel) || !name) {
    throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, "Notification binding is invalid.");
  }

  if (!project.channels.some((endpoint) => endpoint.channel === channel && endpoint.name === name)) {
    throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, "Notification binding is not configured for this project.");
  }

  return { channel, name };
}

function diffLocalState(before: IssueRuntimeState, after: IssueRuntimeState): IssueRepairLocalChange[] {
  const changes: IssueRepairLocalChange[] = [];
  const fields: IssueRepairLocalChange["field"][] = [
    "workflowState", "workflowLabel", "assignedRole", "assignedLevel", "owner", "reviewPolicy", "testPolicy", "notifyTarget",
  ];

  for (const field of fields) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changes.push({ field, before: before[field], after: after[field] });
  }

  return changes;
}

async function applyLocalSourceRepair(
  input: RepairManagedIssueInput,
  context: RepairContext,
  plan: IssueRepairResult,
): Promise<string[]> {
  await applyManagedLabelDiff({
    issueId: input.issueId,
    provider: context.provider,
    diff: plan.diffBefore,
    workflow: context.workflow,
    roles: Object.keys(context.roles),
  });
  const actions = plan.plannedActions.filter((action) => action !== "verify_provider_projection");

  if (plan.metadataAction === "replace") {
    await context.provider.editIssue(input.issueId, {
      body: replaceIssueMetadata(context.providerIssue.description, expectedMetadataFor(context.local)),
    });
  }

  return actions;
}

async function applyProviderSourceRepair(
  input: RepairManagedIssueInput,
  context: RepairContext,
  plan: IssueRepairResult,
): Promise<string[]> {
  const imported = importProviderProjection(context);

  await updateIssueStateStore(input.workspaceDir, input.projectSlug, (store) => {
    const state = store.issues[String(input.issueId)];

    if (!state) throw repairFailure(ISSUE_REPAIR_ERROR.LOCAL_STATE_NOT_FOUND, "Local state disappeared during repair.");
    for (const change of plan.localChanges) {
      if (change.field === "workflowState") state.workflowState = imported.workflowState;
      else if (change.field === "workflowLabel") state.workflowLabel = imported.workflowLabel;
      else if (change.field === "assignedRole") state.assignedRole = imported.assignedRole;
      else if (change.field === "assignedLevel") state.assignedLevel = imported.assignedLevel;
      else if (change.field === "owner") state.owner = imported.owner;
      else if (change.field === "reviewPolicy") state.reviewPolicy = imported.reviewPolicy;
      else if (change.field === "testPolicy") state.testPolicy = imported.testPolicy;
      else state.notifyTarget = imported.notifyTarget;
    }

    state.updatedAt = new Date().toISOString();
  });

  return plan.localChanges.length ? ["update_allowed_local_fields"] : [];
}

function expectedMetadataFor(state: IssueRuntimeState) {
  return { projectSlug: state.projectSlug, issueId: state.issueId, projectionVersion: state.projectionVersion };
}

async function readRateLimit(provider: RepairProvider): Promise<ProviderRateLimitStatus | undefined> {
  try {
    return await provider.getRateLimitStatus?.();
  } catch {
    return undefined;
  }
}

async function setRepairIntegrity(input: RepairManagedIssueInput, status: IssueIntegrityStatus, errors: string[]): Promise<void> {
  await updateIssueStateStore(input.workspaceDir, input.projectSlug, (store) => {
    const state = store.issues[String(input.issueId)];

    if (!state) return;
    state.integrityStatus = status;
    state.integrityErrors = errors;
    state.updatedAt = new Date().toISOString();
  });
}

function blocked(plan: IssueRepairResult, code: IssueRepairErrorCode, message: string, retryable: boolean): IssueRepairResult {
  return { ...plan, success: false, status: "blocked", error: { code, message, retryable } };
}

function mapRepairFailure(plan: IssueRepairResult, error: unknown): IssueRepairResult {
  if (isIssueRepairFailure(error)) {
    return {
      ...blocked(plan, error.code, error.message, error.retryable),
      recoveryPlan: ["Keep local integrity blocked.", "Run a new dry-run before retrying apply."],
    };
  }

  if (isProviderIssueLookupError(error)) {
    if (error.code === PROVIDER_ISSUE_LOOKUP_ERROR.RATE_LIMITED) {
      return {
        ...blocked(plan, ISSUE_REPAIR_ERROR.PROVIDER_RATE_LIMITED, error.message, true),
        recoveryPlan: ["Wait for provider quota reset.", "Run a new dry-run before retrying apply."],
      };
    }

    if (error.code === PROVIDER_ISSUE_LOOKUP_ERROR.UNAUTHORIZED || error.code === PROVIDER_ISSUE_LOOKUP_ERROR.FORBIDDEN) {
      return blocked(plan, ISSUE_REPAIR_ERROR.PROVIDER_FORBIDDEN, error.message, false);
    }

    if (error.code === PROVIDER_ISSUE_LOOKUP_ERROR.TRANSIENT) {
      return blocked(plan, ISSUE_REPAIR_ERROR.PROVIDER_TRANSIENT_ERROR, error.message, true);
    }
  }

  return {
    ...blocked(plan, ISSUE_REPAIR_ERROR.REPAIR_APPLY_FAILED, error instanceof Error ? error.message : String(error), true),
    recoveryPlan: ["Keep local integrity blocked.", "Inspect provider state and run a new dry-run."],
  };
}

function repairFailure(code: IssueRepairErrorCode, message: string, retryable = false): IssueRepairFailure {
  return new IssueRepairFailure(code, message, retryable);
}

async function auditRepair(
  input: RepairManagedIssueInput,
  event: string,
  correlationId: string,
  result: IssueRepairResult,
): Promise<void> {
  await auditLog(input.workspaceDir, event, {
    projectSlug: input.projectSlug,
    issueId: input.issueId,
    source: input.source,
    actor: input.actor,
    channelContext: input.channelContext,
    correlationId,
    reason: input.reason,
    missingManagedLabels: result.diffBefore.missingManagedLabels,
    unexpectedManagedLabels: result.diffBefore.unexpectedManagedLabels,
    localChanges: result.localChanges.map((change) => change.field),
  });
}
