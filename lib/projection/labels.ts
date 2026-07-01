/**
 * projection/labels.ts — Managed provider label detection and rendering.
 */
import type { IssueRuntimeState } from "../issues/index.js";
import { NOTIFY_LABEL_PREFIX, OWNER_LABEL_PREFIX } from "../domain/workflow/index.js";
import type { ManagedLabelOptions } from "./types.js";

const DEVCLAW_LABEL_PREFIX = "devclaw:";
const ROUTING_PREFIXES = ["review:", "test:"];

export function expectedManagedLabels(state: IssueRuntimeState): string[] {
  const labels = new Set<string>();
  labels.add(state.workflowLabel);

  if (state.assignedRole && state.assignedLevel) {
    labels.add(`${state.assignedRole}:${state.assignedLevel}`);
  }
  if (state.owner) labels.add(`${OWNER_LABEL_PREFIX}${state.owner}`);
  if (state.reviewPolicy) labels.add(`review:${state.reviewPolicy}`);
  if (state.testPolicy) labels.add(`test:${state.testPolicy}`);
  if (state.notifyTarget) labels.add(`${NOTIFY_LABEL_PREFIX}${state.notifyTarget.channel}:${state.notifyTarget.name}`);

  return [...labels].filter(Boolean).sort();
}

export function isManagedLabel(label: string, options: ManagedLabelOptions): boolean {
  if (options.stateLabels.includes(label)) return true;
  if (label.startsWith(OWNER_LABEL_PREFIX)) return true;
  if (label.startsWith(NOTIFY_LABEL_PREFIX)) return true;
  if (label.startsWith(DEVCLAW_LABEL_PREFIX)) return true;
  if (ROUTING_PREFIXES.some((prefix) => label.startsWith(prefix))) return true;

  const [role, level] = label.split(":");
  if (!role || !level) return false;
  if (role === "review" || role === "test" || role === "notify" || role === "owner" || role === "devclaw") return false;
  return !options.roles || options.roles.includes(role);
}
