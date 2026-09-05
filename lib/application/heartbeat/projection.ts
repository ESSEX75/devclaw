/**
 * projection.ts — Heartbeat projection integrity pass.
 */
import { log as auditLog } from "../../audit.js";
import type { Project } from "../../domain/index.js";
import { ISSUE_INTEGRITY_STATUS, type IssueRuntimeState, type WorkflowConfig } from "../../domain/index.js";
import type { IssueReader, LabelProjector } from "../../integrations/providers/capabilities.js";
import { isProviderIssueLookupError, PROVIDER_ISSUE_LOOKUP_ERROR } from "../../integrations/providers/index.js";
import {
  extractIssueMetadata,
  metadataMatches,
  type ProjectionDiff,
} from "../../projection/index.js";
import { readIssueStateStore, updateIssueStateStore } from "../../state/issues/index.js";
import { archiveManagedIssue } from "../issues/index.js";
import { reconcileManagedLabels } from "../projection/index.js";

export type ProjectionIntegrityAction =
  | "label_repair"
  | "metadata_error"
  | "provider_missing"
  | "provider_fetch_error";

export type ProjectionIntegrityEvent = {
  issueId: number;
  action: ProjectionIntegrityAction;
  diff?: ProjectionDiff;
  errors?: string[];
};

export type ProjectionIntegrityResult = {
  checked: number;
  removed: number;
  repaired: number;
  errors: number;
  skipped: number;
  events: ProjectionIntegrityEvent[];
};

export async function projectionIntegrityPass(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug">;
  provider: Pick<IssueReader, "getIssue">
    & Pick<LabelProjector, "ensureLabel" | "addLabel" | "removeLabels">;
  workflow: WorkflowConfig;
  roles: string[];
  now?: Date;
}): Promise<ProjectionIntegrityResult> {
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

  for (const state of states) {
    result.checked++;
    let issue: Awaited<ReturnType<typeof provider.getIssue>>;

    try {
      issue = await provider.getIssue(state.issueId);
    } catch (err) {
      if (isProviderIssueLookupError(err) && err.code === PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND) {
        result.events.push({ issueId: state.issueId, action: "provider_missing" });
        const missing = await recordProviderMissing(workspaceDir, project.slug, state.issueId, opts.now ?? new Date());

        await auditLog(workspaceDir, "issue_provider_deleted_detected", {
          projectSlug: project.slug,
          issueId: state.issueId,
          provider: state.provider,
          actor: "heartbeat_projection",
          reason: "confirmed_issue_not_found",
          correlationId: `provider-deleted:${project.slug}:${state.issueId}`,
          confirmations: missing.confirmations,
        });

        const stableMissing = missing.confirmations >= 3
          && Date.parse(missing.lastConfirmedAt) - Date.parse(missing.firstConfirmedAt) >= 15 * 60_000;

        if (stableMissing && !state.activeWorker) {
          const archive = await archiveManagedIssue({
            workspaceDir,
            projectSlug: project.slug,
            issueId: state.issueId,
            archiveReason: "provider_deleted",
            providerDeletedAt: missing.lastConfirmedAt,
            actor: "heartbeat_projection",
            correlationId: `provider-deleted:${project.slug}:${state.issueId}`,
          });

          if (archive.archived) result.removed++;
        } else {
          result.skipped++;
        }

        continue;
      }

      result.errors++;
      const message = err instanceof Error ? err.message : String(err);
      const errors = [`provider issue fetch failed: ${message}`];

      result.events.push({ issueId: state.issueId, action: "provider_fetch_error", errors });
      await markIntegrityError(workspaceDir, project.slug, state.issueId, errors);
      await auditLog(workspaceDir, "issue_projection_integrity_error", {
        projectSlug: project.slug,
        issueId: state.issueId,
        reason: "provider_fetch_error",
        errors,
      });
      continue;
    }

    if (state.providerMissing) await clearProviderMissing(workspaceDir, project.slug, state.issueId);

    if (issue.state === "closed" || issue.state === "CLOSED") {
      result.skipped++;
      continue;
    }

    const metadata = extractIssueMetadata(issue.description ?? "");
    const expectedMetadata = {
      projectSlug: project.slug,
      issueId: state.issueId,
      projectionVersion: state.projectionVersion,
    };

    if (!metadataMatches(metadata, expectedMetadata)) {
      result.errors++;
      const errors = [
        metadata
          ? "issue metadata does not match local issue state"
          : "issue metadata is missing",
      ];

      result.events.push({ issueId: state.issueId, action: "metadata_error", errors });
      await markIntegrityError(workspaceDir, project.slug, state.issueId, errors);
      await auditLog(workspaceDir, "issue_projection_integrity_error", {
        projectSlug: project.slug,
        issueId: state.issueId,
        reason: metadata ? "metadata_mismatch" : "metadata_missing",
        errors,
      });
      continue;
    }

    const { diff } = await reconcileManagedLabels({
      workspaceDir,
      projectSlug: project.slug,
      issueId: state.issueId,
      workflow,
      roles,
      provider,
      owner: "heartbeat_projection_repair",
    });

    if (diff.missingManagedLabels.length === 0 && diff.unexpectedManagedLabels.length === 0) {
      if (state.integrityStatus !== ISSUE_INTEGRITY_STATUS.OK || state.integrityErrors.length > 0) {
        await setIntegrityStatus(workspaceDir, project.slug, state.issueId, ISSUE_INTEGRITY_STATUS.OK, []);
      }

      continue;
    }

    result.repaired++;
    result.events.push({ issueId: state.issueId, action: "label_repair", diff });
    await setIntegrityStatus(workspaceDir, project.slug, state.issueId, ISSUE_INTEGRITY_STATUS.OK, []);
    await auditLog(workspaceDir, "issue_projection_label_repair", {
      projectSlug: project.slug,
      issueId: state.issueId,
      missingManagedLabels: diff.missingManagedLabels,
      unexpectedManagedLabels: diff.unexpectedManagedLabels,
    });
  }

  return result;
}

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

    issue.providerMissing = missing;
    issue.integrityStatus = ISSUE_INTEGRITY_STATUS.PROJECTION_DRIFT;
    issue.integrityErrors = [`provider_missing_pending:${missing.confirmations}`];
    issue.updatedAt = timestamp;

    return missing;
  });
}

async function clearProviderMissing(workspaceDir: string, projectSlug: string, issueId: number): Promise<void> {
  await updateIssueStateStore(workspaceDir, projectSlug, (data) => {
    const issue = data.issues[String(issueId)];

    if (!issue) return;
    issue.providerMissing = null;
    if (issue.integrityErrors.every((message) => message.startsWith("provider_missing_pending:"))) {
      issue.integrityStatus = ISSUE_INTEGRITY_STATUS.OK;
      issue.integrityErrors = [];
    }

    issue.updatedAt = new Date().toISOString();
  });
}

async function markIntegrityError(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  errors: string[],
): Promise<void> {
  await setIntegrityStatus(workspaceDir, projectSlug, issueId, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, errors);
}

async function setIntegrityStatus(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  integrityStatus: IssueRuntimeState["integrityStatus"],
  integrityErrors: string[],
): Promise<void> {
  await updateIssueStateStore(workspaceDir, projectSlug, (data) => {
    const issue = data.issues[String(issueId)];

    if (!issue) return;
    issue.integrityStatus = integrityStatus;
    issue.integrityErrors = integrityErrors;
    issue.updatedAt = new Date().toISOString();
  });
}
