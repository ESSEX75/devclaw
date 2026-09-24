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
import { ISSUE_REPAIR_ERROR, ISSUE_REPAIR_SOURCE } from "./const.js";
import { repairFailure } from "./failure.js";
import type { IssueRepairLocalChange, IssueRepairResult, RepairContext, RepairManagedIssueInput } from "./types.js";

/** Build a deterministic plan and token from immutable snapshots. */
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

/** Validate and interpret provider projection only for explicit repair. */
export function importProviderProjection(context: RepairContext): IssueRuntimeState {
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
    if (!roleConfig.levels[level]) {
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


/** Render expected metadata identity from local state. */
export function expectedMetadataFor(state: IssueRuntimeState) {
  return { projectSlug: state.projectSlug, issueId: state.issueId, projectionVersion: state.projectionVersion };
}
