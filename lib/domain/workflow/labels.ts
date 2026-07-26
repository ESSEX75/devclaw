/**
 * workflow/labels.ts — Label formatting, detection, and routing helpers.
 */
import type { NotificationChannel } from "../shared/types.js";
import {
  DEFAULT_ROLE_LABEL_COLOR,
  NOTIFY_LABEL_PREFIX,
  OWNER_LABEL_PREFIX,
  REVIEW_POLICY,
  ROLE_LABEL_COLORS,
  ROUTING_LABELS,
  STEP_ROUTING_COLOR,
  TEST_POLICY,
} from "./const.js";
import type { ReviewPolicy, RoleDefinition, RoutingLabel, TestPolicy } from "./types.js";

/** Internal mapping of channel definitions. */
type WorkflowChannel = {
  channelId: string;
  channel: NotificationChannel;
  name: string;
  events: string[];
  accountId?: string;
  threadId?: string;
};

// ---------------------------------------------------------------------------
// Step routing labels
// ---------------------------------------------------------------------------

/** Known step routing labels (created on the provider during project registration). */
const STEP_ROUTING_LABELS: readonly string[] = Object.values(ROUTING_LABELS);

// ---------------------------------------------------------------------------
// Notify labels — channel routing for notifications
// ---------------------------------------------------------------------------


/** Build the notify label for a channel endpoint. */
export function getNotifyLabel(channel: NotificationChannel, nameOrIndex: string): string {
  return `${NOTIFY_LABEL_PREFIX}${channel}:${nameOrIndex}`;
}

/**
 * Resolve which channel should receive notifications for an issue.
 * Each issue has at most one notify label. Falls back to the first channel.
 */
export function resolveNotifyChannel(
  issueLabels: string[],
  channels: Array<Omit<WorkflowChannel, "events">>,
): Omit<WorkflowChannel, "events" | "name"> | undefined {
  const notifyLabel = issueLabels.find((l) => l.startsWith(NOTIFY_LABEL_PREFIX));

  if (notifyLabel) {
    const value = notifyLabel.slice(NOTIFY_LABEL_PREFIX.length);
    const colonIdx = value.indexOf(":");

    if (colonIdx !== -1) {
      const channelType = value.slice(0, colonIdx);
      const channelName = value.slice(colonIdx + 1);

      return channels.find(
        (ch) => ch.channel === channelType && (ch.name === channelName || String(channels.indexOf(ch)) === channelName),
      ) ?? channels[0];
    }

    return channels[0];
  }

  return channels[0];
}

// ---------------------------------------------------------------------------
// Owner labels — instance identity on issues
// ---------------------------------------------------------------------------


/** Build the owner label for a given instance name. */
export function getOwnerLabel(instanceName: string): string {
  return `${OWNER_LABEL_PREFIX}${instanceName}`;
}

/** Extract the instance name from an issue's labels, or null if unclaimed. */
export function detectOwner(issueLabels: string[]): string | null {
  const label = issueLabels.find((l) => l.startsWith(OWNER_LABEL_PREFIX));

  return label ? label.slice(OWNER_LABEL_PREFIX.length) : null;
}

/** Check if an issue is owned by the given instance or unclaimed. */
export function isOwnedByOrUnclaimed(
  issueLabels: string[],
  instanceName: string,
): boolean {
  const owner = detectOwner(issueLabels);

  return owner === null || owner === instanceName;
}

// ---------------------------------------------------------------------------
// Review routing
// ---------------------------------------------------------------------------
/**
 * Determine review routing label for an issue based on project policy and developer level.
 */
export function resolveReviewRouting(policy: ReviewPolicy): RoutingLabel {
  if (policy === REVIEW_POLICY.HUMAN) return ROUTING_LABELS.REVIEW_HUMAN;
  if (policy === REVIEW_POLICY.AGENT) return ROUTING_LABELS.REVIEW_AGENT;
  if (policy === REVIEW_POLICY.SKIP) return ROUTING_LABELS.REVIEW_SKIP;

  return ROUTING_LABELS.REVIEW_HUMAN;
}

/**
 * Determine test routing label for an issue based on project policy.
 */
export function resolveTestRouting(policy: TestPolicy): RoutingLabel {
  if (policy === TEST_POLICY.AGENT) return ROUTING_LABELS.TEST_AGENT;

  return ROUTING_LABELS.TEST_SKIP;
}

// ---------------------------------------------------------------------------
// Role labels
// ---------------------------------------------------------------------------


/**
 * Generate all role:level label definitions from resolved config roles.
 */
export function getRoleLabels(
  roles: Record<string, RoleDefinition>,
): Array<{ name: string; color: string }> {
  const labels: Array<{ name: string; color: string }> = [];

  for (const [roleId, role] of Object.entries(roles)) {
    if (role.enabled === false) continue;
    for (const level of role.levels) {
      labels.push({
        name: `${roleId}:${level}`,
        color: getRoleLabelColor(roleId),
      });
    }
  }

  for (const routingLabel of STEP_ROUTING_LABELS) {
    labels.push({ name: routingLabel, color: STEP_ROUTING_COLOR });
  }

  return labels;
}

/** Get the label color for a role. Falls back to gray for unknown roles. */
export function getRoleLabelColor(role: string): string {
  const key = role.toUpperCase() as keyof typeof ROLE_LABEL_COLORS;

  return ROLE_LABEL_COLORS[key] ?? DEFAULT_ROLE_LABEL_COLOR;
}
