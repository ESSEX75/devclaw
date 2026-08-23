import { OWNER_LABEL_PREFIX } from "./const.js";

/** Build the owner label for a given instance name. */
export function getOwnerLabel(instanceName: string): string {
  return `${OWNER_LABEL_PREFIX}${instanceName}`;
}

/** Extract the instance name from an issue's labels, or null if unclaimed. */
export function detectOwner(issueLabels: readonly string[]): string | null {
  const label = issueLabels.find((candidate) => candidate.startsWith(OWNER_LABEL_PREFIX));

  return label ? label.slice(OWNER_LABEL_PREFIX.length) : null;
}

/** Check if an issue is owned by the given instance or unclaimed. */
export function isOwnedByOrUnclaimed(
  issueLabels: readonly string[],
  instanceName: string,
): boolean {
  const owner = detectOwner(issueLabels);

  return owner === null || owner === instanceName;
}
