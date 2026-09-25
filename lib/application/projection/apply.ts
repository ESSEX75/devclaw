/** Applies planned provider label changes without reading or writing local state. */
import {
  DEFAULT_ROLE_LABEL_COLOR,
  getLabelColors,
  getRoleLabelColor,
  getStateLabels,
  NOTIFY_LABEL_COLOR,
  NOTIFY_LABEL_PREFIX,
  OWNER_LABEL_COLOR,
  OWNER_LABEL_PREFIX,
  STEP_ROUTING_COLOR,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { ApplyManagedLabelDiffInput } from "./types.js";

/**
 * Apply only managed labels represented by the deterministic projection diff.
 * @param input - Target issue, provider mutation capability, and expected label delta.
 */
export async function applyManagedLabelDiff(input: ApplyManagedLabelDiffInput): Promise<void> {
  const stateLabels = getStateLabels(input.workflow);

  for (const label of input.diff.missingManagedLabels) {
    await input.provider.ensureLabel(label, managedLabelColor(label, input.workflow, input.roles));
    await input.provider.addLabel(input.issueId, label);
  }

  const staleNonState = input.diff.unexpectedManagedLabels.filter((label) => !stateLabels.includes(label));
  const staleStates = input.diff.unexpectedManagedLabels.filter((label) => stateLabels.includes(label));

  if (staleNonState.length > 0) await input.provider.removeLabels(input.issueId, staleNonState);
  if (staleStates.length > 0) await input.provider.removeLabels(input.issueId, staleStates);
}


/**
 * Resolve the managed color for one label using configured workflow and roles.
 * @param label - Managed label being created.
 * @param workflow - Resolved workflow containing state colors.
 * @param roles - Configured role identifiers for role label colors.
 */
function managedLabelColor(label: string, workflow: WorkflowConfig, roles: string[]): string {
  const stateColor = getLabelColors(workflow).get(label);

  if (stateColor) return stateColor;
  if (label.startsWith(NOTIFY_LABEL_PREFIX)) return NOTIFY_LABEL_COLOR;
  if (label.startsWith(OWNER_LABEL_PREFIX)) return OWNER_LABEL_COLOR;
  if (label.startsWith("review:") || label.startsWith("test:")) return STEP_ROUTING_COLOR;

  const role = roles.find((candidate) => label.startsWith(`${candidate}:`));

  return role ? getRoleLabelColor(role) : DEFAULT_ROLE_LABEL_COLOR;
}
