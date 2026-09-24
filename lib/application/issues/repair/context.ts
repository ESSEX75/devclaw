/**
 * Loads fresh local and provider snapshots for repair planning and apply.
 */
import { createProvider, isProviderIssueLookupError, type Issue, PROVIDER_ISSUE_LOOKUP_ERROR } from "../../../integrations/providers/index.js";
import { loadConfig, readIssueStateStore, readProjects } from "../../../state/index.js";
import { ISSUE_REPAIR_ERROR } from "./const.js";
import { repairFailure } from "./failure.js";
import type { RepairContext, RepairManagedIssueInput } from "./types.js";

/** Read fresh snapshots and classify provider lookup failures. */
export async function resolveRepairContext(input: RepairManagedIssueInput): Promise<RepairContext> {
  const projects = await readProjects(input.workspaceDir);
  const project = projects.projects[input.projectSlug];

  if (!project) throw repairFailure(ISSUE_REPAIR_ERROR.PROJECT_NOT_FOUND, `Project "${input.projectSlug}" not found.`);
  const config = await loadConfig(input.workspaceDir, project.slug);
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

  return { project, workflow: config.workflow, roles: config.roles, local: structuredClone(local), providerIssue: structuredClone(providerIssue), provider };
}
