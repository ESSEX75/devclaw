/**
 * projection.ts — Heartbeat projection integrity pass.
 */

import { log as auditLog } from "../../audit.js";
import { ISSUE_ARCHIVE_REASON, ISSUE_INTEGRITY_STATUS, type IssueRuntimeState, UNVERIFIED_INTEGRITY_ERROR } from "../../domain/index.js";
import { isProviderIssueLookupError, PROVIDER_ISSUE_LOOKUP_ERROR } from "../../integrations/providers/index.js";
import {
  extractIssueMetadata,
  metadataMatches,
} from "../../projection/index.js";
import { isIssueCreationReady, readIssueStateStore, updateIssueStateStore, withIssueOrchestrationLock } from "../../state/index.js";
import { archiveManagedIssueLocked } from "../issues/index.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";
import {
  HEARTBEAT_MISSING_CONFIRMATIONS,
  HEARTBEAT_MISSING_DURATION_MS,
  HEARTBEAT_PROJECTION_AUDIT_EVENT,
  HEARTBEAT_PROJECTION_AUDIT_REASON,
  HEARTBEAT_PROJECTION_ERROR,
  HEARTBEAT_PROJECTION_OWNER,
  HEARTBEAT_PROVIDER_DELETED_CORRELATION_PREFIX,
  PROJECTION_INTEGRITY_ACTION,
} from "./const.js";
import type { ProjectionIntegrityInput, ProjectionIntegrityResult } from "./types.js";

/** Check provider identity and metadata under the issue lock before reconciling labels.
 * Only diagnostics verified by this pass can be cleared; unrelated blockers remain.
 * @param opts - Resolved project/provider dependencies and optional observation timestamp.
 */
export async function projectionIntegrityPass(opts: ProjectionIntegrityInput): Promise<ProjectionIntegrityResult> {
  const { workspaceDir, project, provider, workflow, roles } = opts;
  const store = await readIssueStateStore(workspaceDir, project.slug);
  const states = Object.values(store.issues);
  const result: ProjectionIntegrityResult = {
    checked: 0,
    removed: 0,
    repaired: 0,
    errors: 0,
    skipped: 0,
    events: [],
  };

  for (const candidate of states) {
    await withIssueOrchestrationLock(workspaceDir, project.slug, candidate.issueId, async () => {
      const state = (await readIssueStateStore(workspaceDir, project.slug)).issues[String(candidate.issueId)];

      if (!state) return;
      if (!await isIssueCreationReady(workspaceDir, project.slug, state.creationOperationId)) return;
      result.checked++;
      let issue: Awaited<ReturnType<typeof provider.getIssue>>;

      try {
        issue = await provider.getIssue(state.issueId);
      } catch (err) {
        if (isProviderIssueLookupError(err) && err.code === PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND) {
          result.events.push({ issueId: state.issueId, action: PROJECTION_INTEGRITY_ACTION.PROVIDER_MISSING });
          const missing = await recordProviderMissing(workspaceDir, project.slug, state.issueId, opts.now ?? new Date());
          const correlationId = `${HEARTBEAT_PROVIDER_DELETED_CORRELATION_PREFIX}${project.slug}:${state.issueId}`;

          await auditLog(workspaceDir, HEARTBEAT_PROJECTION_AUDIT_EVENT.PROVIDER_DELETED_DETECTED, {
            projectSlug: project.slug,
            issueId: state.issueId,
            provider: state.provider,
            actor: HEARTBEAT_PROJECTION_OWNER.INSPECTION,
            reason: HEARTBEAT_PROJECTION_AUDIT_REASON.ISSUE_NOT_FOUND,
            correlationId,
            confirmations: missing.confirmations,
          });

          const stableMissing = missing.confirmations >= HEARTBEAT_MISSING_CONFIRMATIONS
            && Date.parse(missing.lastConfirmedAt) - Date.parse(missing.firstConfirmedAt) >= HEARTBEAT_MISSING_DURATION_MS;

          if (stableMissing && !state.activeWorker) {
            const archive = await archiveManagedIssueLocked({
              workspaceDir,
              projectSlug: project.slug,
              issueId: state.issueId,
              archiveReason: ISSUE_ARCHIVE_REASON.PROVIDER_DELETED,
              providerDeletedAt: missing.lastConfirmedAt,
              actor: HEARTBEAT_PROJECTION_OWNER.INSPECTION,
              correlationId,
            });

            if (archive.archived) result.removed++;
          } else {
            result.skipped++;
          }

          return;
        }

        result.errors++;
        const message = err instanceof Error ? err.message : String(err);
        const errors = [`${HEARTBEAT_PROJECTION_ERROR.FETCH_PREFIX}${message}`];

        result.events.push({ issueId: state.issueId, action: PROJECTION_INTEGRITY_ACTION.PROVIDER_FETCH_ERROR, errors });
        await markIntegrityError(workspaceDir, project.slug, state.issueId, errors);
        await auditLog(workspaceDir, HEARTBEAT_PROJECTION_AUDIT_EVENT.INTEGRITY_ERROR, {
          projectSlug: project.slug,
          issueId: state.issueId,
          reason: HEARTBEAT_PROJECTION_AUDIT_REASON.PROVIDER_FETCH_ERROR,
          errors,
        });

        return;
      }

      if (state.providerMissing) await clearProviderMissing(workspaceDir, project.slug, state.issueId);

      const metadata = extractIssueMetadata(issue.description ?? "");
      const expectedMetadata = {
        projectSlug: project.slug,
        issueId: state.issueId,
      };

      if (!metadataMatches(metadata, expectedMetadata)) {
        result.errors++;
        const errors = [
          metadata
            ? HEARTBEAT_PROJECTION_ERROR.METADATA_MISMATCH
            : HEARTBEAT_PROJECTION_ERROR.METADATA_MISSING,
        ];

        result.events.push({ issueId: state.issueId, action: PROJECTION_INTEGRITY_ACTION.METADATA_ERROR, errors });
        await markIntegrityError(workspaceDir, project.slug, state.issueId, errors);
        await auditLog(workspaceDir, HEARTBEAT_PROJECTION_AUDIT_EVENT.INTEGRITY_ERROR, {
          projectSlug: project.slug,
          issueId: state.issueId,
          reason: metadata ? HEARTBEAT_PROJECTION_AUDIT_REASON.METADATA_MISMATCH
            : HEARTBEAT_PROJECTION_AUDIT_REASON.METADATA_MISSING,
          errors,
        });

        return;
      }

      const { diff } = await reconcileManagedLabelsLocked({
        workspaceDir,
        projectSlug: project.slug,
        issueId: state.issueId,
        workflow,
        roles,
        provider,
        owner: HEARTBEAT_PROJECTION_OWNER.REPAIR,
      });

      if (diff.missingManagedLabels.length === 0 && diff.unexpectedManagedLabels.length === 0) {
        if (state.integrityStatus !== ISSUE_INTEGRITY_STATUS.OK || state.integrityErrors.length > 0) {
          await setIntegrityStatus(workspaceDir, project.slug, state.issueId, ISSUE_INTEGRITY_STATUS.OK, []);
        }

        return;
      }

      result.repaired++;
      result.events.push({ issueId: state.issueId, action: PROJECTION_INTEGRITY_ACTION.LABEL_REPAIR, diff });
      await setIntegrityStatus(workspaceDir, project.slug, state.issueId, ISSUE_INTEGRITY_STATUS.OK, []);
      await auditLog(workspaceDir, HEARTBEAT_PROJECTION_AUDIT_EVENT.LABEL_REPAIR, {
        projectSlug: project.slug,
        issueId: state.issueId,
        missingManagedLabels: diff.missingManagedLabels,
        unexpectedManagedLabels: diff.unexpectedManagedLabels,
      });
    });
  }

  return result;
}

/** Record confirmed absence while preserving independent failures.
 * @param workspaceDir - Workspace containing issue state.
 * @param projectSlug - Canonical owning project.
 * @param issueId - Provider issue identifier.
 * @param now - Time of the confirmed absence.
 */
async function recordProviderMissing(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  now: Date,
): Promise<NonNullable<IssueRuntimeState["providerMissing"]>> {
  return updateIssueStateStore(workspaceDir, projectSlug, (data) => {
    const issue = data.issues[String(issueId)];

    if (!issue) throw new Error(`Issue #${issueId} has no active state for provider-missing confirmation.`);
    const timestamp = now.toISOString();
    const missing = issue.providerMissing
      ? { ...issue.providerMissing, confirmations: issue.providerMissing.confirmations + 1, lastConfirmedAt: timestamp }
      : { confirmations: 1, firstConfirmedAt: timestamp, lastConfirmedAt: timestamp };

    const retainedErrors = issue.integrityErrors.filter(message => !message.startsWith(HEARTBEAT_PROJECTION_ERROR.MISSING_PREFIX));

    if (issue.integrityStatus !== ISSUE_INTEGRITY_STATUS.OK && issue.integrityErrors.length === 0) retainedErrors.push(UNVERIFIED_INTEGRITY_ERROR);
    const updated = {
      ...issue,
      providerMissing: missing,
      integrityStatus: retainedErrors.length > 0 || issue.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR
        ? ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR : ISSUE_INTEGRITY_STATUS.PROJECTION_DRIFT,
      integrityErrors: [...retainedErrors,
        `${HEARTBEAT_PROJECTION_ERROR.MISSING_PREFIX}${missing.confirmations}`],
      updatedAt: timestamp,
    };

    return { store: { ...data, issues: { ...data.issues, [String(issueId)]: updated } }, result: missing };
  });
}

/** Clear only provider-missing diagnostics after a successful lookup.
 * @param workspaceDir - Workspace containing issue state.
 * @param projectSlug - Canonical owning project.
 * @param issueId - Provider issue identifier.
 */
async function clearProviderMissing(workspaceDir: string, projectSlug: string, issueId: number): Promise<void> {
  await updateIssueStateStore(workspaceDir, projectSlug, (data) => {
    const issue = data.issues[String(issueId)];

    if (!issue) return { store: data, result: undefined };
    const integrityErrors = issue.integrityErrors.filter(message => !message.startsWith(HEARTBEAT_PROJECTION_ERROR.MISSING_PREFIX));
    const clearIntegrity = integrityErrors.length === 0 && integrityErrors.length !== issue.integrityErrors.length;
    const updated = {
      ...issue,
      providerMissing: null,
      integrityStatus: clearIntegrity ? ISSUE_INTEGRITY_STATUS.OK : issue.integrityStatus,
      integrityErrors,
      updatedAt: new Date().toISOString(),
    };

    return { store: { ...data, issues: { ...data.issues, [String(issueId)]: updated } }, result: undefined };
  });
}

/** Add observed heartbeat errors without discarding independent blockers.
 * @param workspaceDir - Workspace containing issue state.
 * @param projectSlug - Canonical owning project.
 * @param issueId - Provider issue identifier.
 * @param errors - Observed errors retained until their own verification succeeds.
 */
async function markIntegrityError(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  errors: string[],
): Promise<void> {
  await setIntegrityStatus(workspaceDir, projectSlug, issueId, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, errors);
}

/** Merge failures or clear only verified heartbeat provider/metadata diagnostics.
 * @param workspaceDir - Workspace containing issue state.
 * @param projectSlug - Canonical owning project.
 * @param issueId - Provider issue identifier.
 * @param integrityStatus - Whether this observation verified heartbeat projection checks.
 * @param integrityErrors - New diagnostics; empty on successful verification.
 */
async function setIntegrityStatus(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  integrityStatus: IssueRuntimeState["integrityStatus"],
  integrityErrors: string[],
): Promise<void> {
  await updateIssueStateStore(workspaceDir, projectSlug, (data) => {
    const issue = data.issues[String(issueId)];

    if (!issue) return { store: data, result: undefined };
    const retained = integrityStatus === ISSUE_INTEGRITY_STATUS.OK
      ? issue.integrityErrors.filter(message => message !== HEARTBEAT_PROJECTION_ERROR.METADATA_MISSING
        && message !== HEARTBEAT_PROJECTION_ERROR.METADATA_MISMATCH && !message.startsWith(HEARTBEAT_PROJECTION_ERROR.FETCH_PREFIX))
      : [...issue.integrityErrors];

    if (integrityErrors.length > 0 && issue.integrityStatus !== ISSUE_INTEGRITY_STATUS.OK && issue.integrityErrors.length === 0) {
      retained.push(UNVERIFIED_INTEGRITY_ERROR);
    }

    const errors = [...new Set([...retained, ...integrityErrors])];
    const clearedOwnedErrors = retained.length !== issue.integrityErrors.length;
    const status = errors.length > 0 ? ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR
      : clearedOwnedErrors ? ISSUE_INTEGRITY_STATUS.OK : issue.integrityStatus;
    const updated = { ...issue, integrityStatus: status, integrityErrors: errors, updatedAt: new Date().toISOString() };

    return { store: { ...data, issues: { ...data.issues, [String(issueId)]: updated } }, result: undefined };
  });
}
