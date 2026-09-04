import { log as auditLog } from "../../audit.js";
import {
  DEFAULT_ROLE_LABEL_COLOR,
  getLabelColors,
  getRoleLabelColor,
  getStateLabels,
  ISSUE_INTEGRITY_STATUS,
  NOTIFY_LABEL_COLOR,
  NOTIFY_LABEL_PREFIX,
  OWNER_LABEL_COLOR,
  OWNER_LABEL_PREFIX,
  STEP_ROUTING_COLOR,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { IssueReader, LabelProjector } from "../../integrations/providers/capabilities.js";
import { diffIssueProjection, type ProjectionDiff } from "../../projection/index.js";
import {
  readIssueStateStore,
  updateIssueStateStore,
  withIssueOrchestrationLock,
} from "../../state/issues/index.js";

type ProjectionProvider = Pick<IssueReader, "getIssue">
  & Pick<LabelProjector, "ensureLabel" | "addLabel" | "removeLabels">;

export type ManagedProjectionResult = {
  issueId: number;
  before: string[];
  diff: ProjectionDiff;
  changed: boolean;
};

export type ReconcileManagedLabelsInput = {
  workspaceDir: string;
  projectSlug: string;
  issueId: number;
  workflow: WorkflowConfig;
  roles?: string[];
  provider: ProjectionProvider;
  owner: string;
};

export function reconcileManagedLabels(input: ReconcileManagedLabelsInput): Promise<ManagedProjectionResult> {
  return withIssueOrchestrationLock(
    input.workspaceDir,
    input.projectSlug,
    input.issueId,
    () => reconcileManagedLabelsLocked(input),
  );
}

/** Reconcile while the caller already owns this issue's orchestration lock. */
export async function reconcileManagedLabelsLocked(
  input: ReconcileManagedLabelsInput,
): Promise<ManagedProjectionResult> {
  const store = await readIssueStateStore(input.workspaceDir, input.projectSlug);
  const state = store.issues[String(input.issueId)];

  if (!state) throw new Error(`Issue #${input.issueId} has no initialized local runtime state.`);

  const issue = await input.provider.getIssue(input.issueId);
  const stateLabels = getStateLabels(input.workflow);
  const roles = input.roles ?? configuredWorkflowRoles(input.workflow);
  const diff = diffIssueProjection({
    state,
    actualLabels: issue.labels,
    options: { stateLabels, roles },
  });

  try {
    for (const label of diff.missingManagedLabels) {
      await input.provider.ensureLabel(label, managedLabelColor(label, input.workflow, roles));
      await input.provider.addLabel(input.issueId, label);
    }

    const staleNonState = diff.unexpectedManagedLabels.filter((label) => !stateLabels.includes(label));
    const staleStates = diff.unexpectedManagedLabels.filter((label) => stateLabels.includes(label));

    if (staleNonState.length > 0) await input.provider.removeLabels(input.issueId, staleNonState);
    if (staleStates.length > 0) await input.provider.removeLabels(input.issueId, staleStates);

    await setProjectionIntegrity(input, ISSUE_INTEGRITY_STATUS.OK, []);
    await auditLog(input.workspaceDir, "issue_projection_reconciled", {
      projectSlug: input.projectSlug,
      issueId: input.issueId,
      owner: input.owner,
      before: issue.labels,
      expected: diff.expectedManagedLabels,
      missingManagedLabels: diff.missingManagedLabels,
      unexpectedManagedLabels: diff.unexpectedManagedLabels,
    });

    return {
      issueId: input.issueId,
      before: issue.labels,
      diff,
      changed: diff.missingManagedLabels.length > 0 || diff.unexpectedManagedLabels.length > 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await setProjectionIntegrity(input, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, [
      `managed projection failed for ${input.owner}: ${message}`,
    ]);
    throw error;
  }
}

function configuredWorkflowRoles(workflow: WorkflowConfig): string[] {
  const roles = new Set<string>();

  for (const state of Object.values(workflow.states)) {
    if (state.role) roles.add(state.role);
  }

  return [...roles];
}

function managedLabelColor(label: string, workflow: WorkflowConfig, roles: string[]): string {
  const stateColor = getLabelColors(workflow).get(label);

  if (stateColor) return stateColor;
  if (label.startsWith(NOTIFY_LABEL_PREFIX)) return NOTIFY_LABEL_COLOR;
  if (label.startsWith(OWNER_LABEL_PREFIX)) return OWNER_LABEL_COLOR;
  if (label.startsWith("review:") || label.startsWith("test:")) return STEP_ROUTING_COLOR;

  const role = roles.find((candidate) => label.startsWith(`${candidate}:`));

  return role ? getRoleLabelColor(role) : DEFAULT_ROLE_LABEL_COLOR;
}

async function setProjectionIntegrity(
  input: Pick<ReconcileManagedLabelsInput, "workspaceDir" | "projectSlug" | "issueId">,
  status: typeof ISSUE_INTEGRITY_STATUS.OK | typeof ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR,
  errors: string[],
): Promise<void> {
  await updateIssueStateStore(input.workspaceDir, input.projectSlug, (store) => {
    const state = store.issues[String(input.issueId)];

    if (!state) return;
    state.integrityStatus = status;
    state.integrityErrors = errors;
    state.updatedAt = new Date().toISOString();
  });
}
