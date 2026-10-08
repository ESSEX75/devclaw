/** Owns workflow label selection and two-phase provider effects; labels never establish local runtime truth. */

import { getLabelColors, getStateLabels, type WorkflowConfig } from "../../domain/index.js";
import type { Issue, IssueProvider, LabelProjector } from "../../integrations/providers/contracts/index.js";

/** Ensure the exact labels and colors selected by the resolved workflow.
 * @param provider - Explicit provider label capability.
 * @param workflow - Application-resolved configuration, including custom states.
 */
export async function ensureWorkflowLabels(provider: LabelProjector, workflow: WorkflowConfig): Promise<void> {
  const colors = getLabelColors(workflow);

  for (const label of getStateLabels(workflow)) {
    const color = colors.get(label);

    if (!color) throw new Error(`No color configured for workflow label "${label}".`);
    await provider.ensureLabel(label, color);
  }
}

/** Project an application-selected transition, adding the target before removing obsolete workflow labels.
 * Read failures propagate during required cleanup; final provider diagnostics remain best-effort.
 * This operation does not change workflow state or infer eligibility from provider labels.
 * @param provider - Provider whose explicit label effects apply the projection.
 * @param workflow - Resolved workflow defining the managed label set.
 * @param issueId - Provider issue corresponding to the managed local identity.
 * @param from - Application-selected source label, used only for diagnostics.
 * @param to - Application-selected target label, never derived from external observations.
 * @param observedIssue - Optional fresh provider evidence allowing recovery to skip an already applied addition.
 */
export async function transitionWorkflowLabel(provider: IssueProvider, workflow: WorkflowConfig,
  issueId: number, from: string, to: string, observedIssue?: Issue): Promise<void> {
  if (observedIssue && observedIssue.iid !== issueId) throw new Error("Workflow projection evidence belongs to a different issue.");
  if (!observedIssue?.labels.includes(to)) await provider.addLabels(issueId, [to]);
  const stateLabels = new Set(getStateLabels(workflow));
  const issue = await provider.getIssue(issueId);

  await provider.removeLabels(issueId, issue.labels.filter(label => stateLabels.has(label) && label !== to));
  try {
    const postIssue = await provider.getIssue(issueId);
    const remaining = postIssue.labels.filter(label => stateLabels.has(label));

    if (remaining.length !== 1 || !remaining.includes(to)) {
      console.error(`[state_transition_anomaly] Issue #${issueId}: expected state "${to}", `
        + `found ${remaining.length} state label(s): [${remaining.join(", ")}]. Transition: "${from}" → "${to}".`);
    }
  } catch { /* The projection was applied; an optional diagnostic cannot invalidate it. */ }
}
