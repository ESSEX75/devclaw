/**
 * Builds deterministic repair plans and validates explicit provider-source imports.
 */

import { createHash } from "node:crypto";

import {
  findStateKeyByLabel,
  getStateLabels,
  isNotificationChannel,
  isReviewPolicy,
  type IssueRuntimeState,
  isTestPolicy,
  NOTIFY_LABEL_PREFIX,
  type NotifyBindingRef,
  OWNER_LABEL_PREFIX,
  type Project,
  type ReviewPolicy,
  type TestPolicy,
} from "../../../domain/index.js";
import { diffIssueProjection, expectedManagedLabels, extractIssueMetadata, metadataMatches } from "../../../projection/index.js";
import type { ResolvedRoleConfig } from "../../../state/index.js";
import { REPAIR_ACTION, REPAIR_METADATA_ACTION, REPAIR_MODE, REPAIR_PLAN_HASH_ALGORITHM, REPAIR_POLICY_PREFIX, REPAIR_STATUS, REPAIR_WARNING } from "./const.js";
import { ISSUE_REPAIR_ERROR, ISSUE_REPAIR_SOURCE } from "./const.js";
import { repairFailure } from "./failure.js";
import type { IssueRepairLocalChange, IssueRepairResult, RepairContext, RepairManagedIssueInput } from "./types.js";

/** Build a deterministic plan and token from immutable snapshots.
 * @param input - Validated command input and runtime dependencies.
 * @param context - Fresh local/provider snapshots and resolved project configuration.
 */
export function buildRepairPlan(input: RepairManagedIssueInput, context: RepairContext): IssueRepairResult {
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
    ? REPAIR_METADATA_ACTION.NONE
    : REPAIR_METADATA_ACTION.REPLACE;
  const plannedActions = input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE
    ? [
      ...(diff.missingManagedLabels.length ? [REPAIR_ACTION.ENSURE_MANAGED_LABELS_EXIST, REPAIR_ACTION.ADD_MISSING_MANAGED_LABELS] : []),
      ...(diff.unexpectedManagedLabels.length ? [REPAIR_ACTION.REMOVE_UNEXPECTED_MANAGED_LABELS] : []),
      ...(metadataAction === REPAIR_METADATA_ACTION.REPLACE ? [REPAIR_ACTION.REPLACE_MANAGED_METADATA] : []),
      REPAIR_ACTION.VERIFY_PROVIDER_PROJECTION,
    ]
    : [...(localChanges.length ? [REPAIR_ACTION.UPDATE_ALLOWED_LOCAL_FIELDS] : []), REPAIR_ACTION.VERIFY_PROVIDER_PROJECTION];
  const changed = diff.missingManagedLabels.length > 0
    || diff.unexpectedManagedLabels.length > 0
    || metadataAction === REPAIR_METADATA_ACTION.REPLACE
    || localChanges.length > 0;
  const estimatedProviderRequests = input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE
    ? diff.missingManagedLabels.length * 2 + (diff.unexpectedManagedLabels.length ? 1 : 0) + (metadataAction === REPAIR_METADATA_ACTION.REPLACE ? 1 : 0) + 1
    : 1;
  const tokenPayload = JSON.stringify({
    project: input.projectSlug,
    issueId: input.issueId,
    source: input.source,
    configuration: {
      workflow: context.workflow,
      roles: context.roles,
      repo: context.project.repo,
      provider: context.project.provider,
      channels: context.project.channels,
    },
    local: context.local,
    provider: { ...context.providerIssue, labels: [...context.providerIssue.labels].sort() },
  });

  return {
    success: true,
    mode: input.apply ? REPAIR_MODE.APPLY : REPAIR_MODE.DRY_RUN,
    status: changed ? REPAIR_STATUS.PLANNED : REPAIR_STATUS.ALREADY_CONSISTENT,
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
    warnings: context.provider.getRateLimitStatus ? [] : [{ code: REPAIR_WARNING.STATUS_UNAVAILABLE, message: "Provider does not expose a quota precheck." }],
    estimatedProviderRequests,
    planToken: createHash(REPAIR_PLAN_HASH_ALGORITHM).update(tokenPayload).digest("hex"),
  };
}

/** Validate and interpret provider projection only for explicit repair.
 * @param context - Fresh local/provider snapshots and resolved project configuration.
 */
export function importProviderProjection(context: RepairContext): IssueRuntimeState {
  const labels = context.providerIssue.labels;
  const metadata = extractIssueMetadata(context.providerIssue.description);

  if (!metadata) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, "Managed issue metadata is missing or invalid.");
  if (metadata.projectSlug !== context.project.slug || metadata.issueId !== context.local.issueId) {
    throw repairFailure(ISSUE_REPAIR_ERROR.ISSUE_IDENTITY_MISMATCH, "Provider metadata does not match the selected project and issue.");
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
  };
}

/** Validate that provider labels select at most one configured role and level.
 * @param labels - Observed provider labels; only explicit repair may import them.
 * @param roles - Resolved role definitions including valid custom levels.
 */
function parseSingleRoleLevel(labels: string[], roles: Record<string, ResolvedRoleConfig>): RepairRoleLevel | null {
  const matches: RepairRoleLevel[] = [];

  for (const label of labels) {
    const separator = label.indexOf(":");

    if (separator <= 0) continue;
    const role = label.slice(0, separator);
    const level = label.slice(separator + 1);
    const roleConfig = roles[role];

    if (!roleConfig) continue;
    if (!roleConfig.levels[level]) {
      throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, `Role "${role}" does not define level "${level}".`);
    }

    matches.push({ role, level });
  }

  if (matches.length > 1) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_AMBIGUOUS, "Provider projection has multiple role/level labels.");

  return matches[0] ?? null;
}

/** Reject ambiguous provider values for a single managed field.
 * @param labels - Observed provider labels; only explicit repair may import them.
 * @param prefix - Canonical managed label prefix selected for this field.
 * @param field - Field name used in ambiguity diagnostics.
 */
function parseSinglePrefixedValue(labels: string[], prefix: string, field: string): string | null {
  const values = labels.filter((label) => label.startsWith(prefix)).map((label) => label.slice(prefix.length)).filter(Boolean);

  if (values.length > 1) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_AMBIGUOUS, `Provider projection has multiple ${field} labels.`);

  return values[0] ?? null;
}

/** Validate the projected review policy without supplying a default.
 * @param labels - Observed provider labels; only explicit repair may import them.
 */
function parseReviewPolicy(labels: string[]): ReviewPolicy | null {
  const value = parseSinglePrefixedValue(labels, REPAIR_POLICY_PREFIX.REVIEW, "review policy");

  if (value === null) return null;
  if (!isReviewPolicy(value)) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, `Unknown review policy "${value}".`);

  return value;
}

/** Validate the projected test policy without supplying a default.
 * @param labels - Observed provider labels; only explicit repair may import them.
 */
function parseTestPolicy(labels: string[]): TestPolicy | null {
  const value = parseSinglePrefixedValue(labels, REPAIR_POLICY_PREFIX.TEST, "test policy");

  if (value === null) return null;
  if (!isTestPolicy(value)) throw repairFailure(ISSUE_REPAIR_ERROR.SOURCE_INCOMPLETE, `Unknown test policy "${value}".`);

  return value;
}

/** Validate a projected notification binding against configured project endpoints.
 * @param labels - Observed provider labels; only explicit repair may import them.
 * @param project - Resolved project identity or its canonical slug in results.
 */
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

/** Compare only fields that explicit provider-source repair is allowed to import.
 * @param before - Authoritative snapshot before the proposed import.
 * @param after - Validated snapshot proposed by explicit provider-source repair.
 */
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

/** Render expected metadata identity from local state.
 * @param state - Fresh authoritative runtime record used by this operation.
 */
export function expectedMetadataFor(state: IssueRuntimeState) {
  return { projectSlug: state.projectSlug, issueId: state.issueId };
}

/** Validated role and level imported from one provider label. */
type RepairRoleLevel = {
  /** Configured role owning the selected level. */
  role: string;
  /** Level validated against the resolved role configuration. */
  level: string;
};
