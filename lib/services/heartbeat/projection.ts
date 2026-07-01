/**
 * projection.ts — Heartbeat projection integrity pass.
 */
import { log as auditLog } from "../../audit.js";
import { readIssueStateStore, updateIssueStateStore } from "../../state/issues/index.js";
import type { IssueRuntimeState } from "../../domain/issues/types.js";
import type { Project } from "../../state/projects/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import type { IssueReader, LabelProjector } from "../../integrations/providers/capabilities.js";
import {
  diffIssueProjection,
  extractIssueMetadata,
  metadataMatches,
  type ProjectionDiff,
} from "../../projection/index.js";
import type { WorkflowConfig } from "../../domain/workflow/types.js";
import { getStateLabels } from "../../domain/workflow/queries.js";

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
  provider: Pick<IssueReader, "getIssue"> & Pick<LabelProjector, "addLabel" | "removeLabels">;
  workflow: WorkflowConfig;
  roles: string[];
}): Promise<ProjectionIntegrityResult> {
  const { workspaceDir, project, provider, workflow, roles } = opts;
  const store = await readIssueStateStore(workspaceDir, project.slug);
  const states = Object.values(store.issues)
    .filter((state) => state.managed && state.archivedAt == null);
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
      if (isProviderIssueMissingError(err)) {
        result.removed++;
        result.events.push({ issueId: state.issueId, action: "provider_missing" });
        await removeLocalIssueState(workspaceDir, project.slug, state.issueId);
        await auditLog(workspaceDir, "issue_projection_provider_missing_removed", {
          projectSlug: project.slug,
          issueId: state.issueId,
        });
        continue;
      }

      result.errors++;
      const errors = [`provider issue fetch failed: ${(err as Error).message}`];
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

    const diff = diffIssueProjection({
      state,
      actualLabels: issue.labels,
      options: {
        stateLabels: getStateLabels(workflow),
        roles,
      },
    });

    if (diff.missingManagedLabels.length === 0 && diff.unexpectedManagedLabels.length === 0) {
      if (state.integrityStatus !== "ok" || state.integrityErrors.length > 0) {
        await setIntegrityStatus(workspaceDir, project.slug, state.issueId, "ok", []);
      }
      continue;
    }

    for (const label of diff.missingManagedLabels) {
      await provider.addLabel(state.issueId, label);
    }
    if (diff.unexpectedManagedLabels.length > 0) {
      await provider.removeLabels(state.issueId, diff.unexpectedManagedLabels);
    }

    result.repaired++;
    result.events.push({ issueId: state.issueId, action: "label_repair", diff });
    await setIntegrityStatus(workspaceDir, project.slug, state.issueId, "ok", []);
    await auditLog(workspaceDir, "issue_projection_label_repair", {
      projectSlug: project.slug,
      issueId: state.issueId,
      missingManagedLabels: diff.missingManagedLabels,
      unexpectedManagedLabels: diff.unexpectedManagedLabels,
    });
  }

  return result;
}

function isProviderIssueMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  return normalized.includes("not found")
    || normalized.includes("could not resolve to an issue")
    || normalized.includes("404")
    || normalized.includes("does not exist");
}

async function removeLocalIssueState(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
): Promise<void> {
  await updateIssueStateStore(workspaceDir, projectSlug, (data) => {
    delete data.issues[String(issueId)];
  });
}

async function markIntegrityError(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  errors: string[],
): Promise<void> {
  await setIntegrityStatus(workspaceDir, projectSlug, issueId, "integrity_error", errors);
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
