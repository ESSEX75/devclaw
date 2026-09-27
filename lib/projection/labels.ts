/**
 * projection/labels.ts — Managed provider label detection and rendering.
 */

import { getNotifyLabel, type IssueRuntimeState, NOTIFY_LABEL_PREFIX, OWNER_LABEL_PREFIX, POLICY_LABEL_PREFIX } from "../domain/index.js";
import { DEVCLAW_LABEL_PREFIX } from "./const.js";
import type { ManagedLabelOptions } from "./types.js";


/** Render managed labels from authoritative local fields without provider observations.
 * @param state - Initialized local issue whose workflow and routing fields are authoritative.
 */
export function expectedManagedLabels(state: IssueRuntimeState): string[] {
  const labels = new Set<string>();

  labels.add(state.workflowLabel);

  if (state.assignedRole && state.assignedLevel) {
    labels.add(`${state.assignedRole}:${state.assignedLevel}`);
  }

  if (state.owner) labels.add(`${OWNER_LABEL_PREFIX}${state.owner}`);
  if (state.reviewPolicy) labels.add(`${POLICY_LABEL_PREFIX.REVIEW}${state.reviewPolicy}`);
  if (state.testPolicy) labels.add(`${POLICY_LABEL_PREFIX.TEST}${state.testPolicy}`);
  if (state.notifyTarget) labels.add(getNotifyLabel(state.notifyTarget));

  return [...labels].filter(Boolean).sort();
}

/** Determine whether a provider label belongs to configured workflow, roles, or reserved namespaces.
 * @param label - Observed provider label to classify.
 * @param options - Configured workflow labels and optional custom role registry.
 */
export function isManagedLabel(label: string, options: ManagedLabelOptions): boolean {
  if (options.stateLabels.includes(label)) return true;
  if (label.startsWith(OWNER_LABEL_PREFIX)) return true;
  if (label.startsWith(NOTIFY_LABEL_PREFIX)) return true;
  if (label.startsWith(DEVCLAW_LABEL_PREFIX)) return true;
  if (Object.values(POLICY_LABEL_PREFIX).some((prefix) => label.startsWith(prefix))) return true;

  const [role, level] = label.split(":");

  if (!role || !level) return false;

  return !options.roles || options.roles.includes(role);
}
