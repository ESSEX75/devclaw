/**
 * Defines pure helpers for projecting and detecting DevClaw issue ownership labels.
 */
import { OWNER_LABEL_PREFIX } from "./const.js";

/**
 * Build the owner label for a given instance name.
 *
 * @param instanceName - Stable DevClaw instance name encoded in the label.
 */
export function getOwnerLabel(instanceName: string): string {
  return `${OWNER_LABEL_PREFIX}${instanceName}`;
}

/**
 * Extract the projected instance name from provider labels, or null if absent.
 * This helper is for diagnostics and explicit import/repair boundaries; initialized
 * managed issues must use the owner stored in local runtime state.
 *
 * @param issueLabels - Provider-visible labels to inspect for an ownership marker.
 */
export function detectOwner(issueLabels: readonly string[]): string | null {
  const label = issueLabels.find((candidate) => candidate.startsWith(OWNER_LABEL_PREFIX));

  return label ? label.slice(OWNER_LABEL_PREFIX.length) : null;
}

/**
 * Check whether projected provider labels identify an issue as owned by the given
 * instance or unclaimed. This is a diagnostic predicate, not runtime authorization.
 *
 * @param issueLabels - Provider-visible labels to inspect for an ownership marker.
 * @param instanceName - DevClaw instance allowed to own the issue.
 */
export function isOwnedByOrUnclaimed(
  issueLabels: readonly string[],
  instanceName: string,
): boolean {
  const owner = detectOwner(issueLabels);

  return owner === null || owner === instanceName;
}
