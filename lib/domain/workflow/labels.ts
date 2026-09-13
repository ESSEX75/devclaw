/**
 * Builds provider-visible workflow labels from validated domain configuration.
 */
import {
  DEFAULT_ROLE_LABEL_COLOR,
  DEFAULT_ROLES,
  REVIEW_POLICY,
  ROLE_LABEL_COLORS,
  ROUTING_LABELS,
  STEP_ROUTING_COLOR,
} from "./const.js";
import type { LabelDefinition, ReviewPolicy, RoleDefinition, RoutingLabel } from "./types.js";

/** Known step routing labels (created on the provider during project registration). */
const STEP_ROUTING_LABELS: readonly RoutingLabel[] = Object.values(ROUTING_LABELS);

/** Exhaustive provider-label mapping for supported review policies. */
const REVIEW_ROUTING_LABELS: Readonly<Record<ReviewPolicy, RoutingLabel>> = {
  [REVIEW_POLICY.HUMAN]: ROUTING_LABELS.REVIEW_HUMAN,
  [REVIEW_POLICY.AGENT]: ROUTING_LABELS.REVIEW_AGENT,
  [REVIEW_POLICY.SKIP]: ROUTING_LABELS.REVIEW_SKIP,
};

/**
 * Determine the review routing label for an issue from its resolved policy.
 *
 * @param policy - Validated review policy selected for the issue.
 */
export function resolveReviewRouting(policy: ReviewPolicy): RoutingLabel {
  return REVIEW_ROUTING_LABELS[policy];
}

/**
 * Generate all role:level label definitions from resolved config roles.
 *
 * @param roles - Resolved runtime role definitions used by the workflow.
 */
export function getRoleLabels(
  roles: Readonly<Record<string, RoleDefinition<string>>>,
): LabelDefinition[] {
  const labels: LabelDefinition[] = [];

  for (const [roleId, role] of Object.entries(roles)) {
    if (role.enabled === false) continue;
    const color = getRoleLabelColor(roleId);

    for (const level of Object.keys(role.levels)) {
      labels.push({
        name: `${roleId}:${level}`,
        color,
      });
    }
  }

  return labels;
}

/** Generate the fixed review and test routing labels understood by the workflow engine. */
export function getStepRoutingLabels(): LabelDefinition[] {
  return STEP_ROUTING_LABELS.map((name) => ({ name, color: STEP_ROUTING_COLOR }));
}

/**
 * Get the label color for a role. Falls back to gray for unknown roles.
 *
 * @param role - Runtime-configured role identifier to present.
 */
export function getRoleLabelColor(role: string): string {
  if (role === DEFAULT_ROLES.DEVELOPER) return ROLE_LABEL_COLORS.DEVELOPER;
  if (role === DEFAULT_ROLES.TESTER) return ROLE_LABEL_COLORS.TESTER;
  if (role === DEFAULT_ROLES.ARCHITECT) return ROLE_LABEL_COLORS.ARCHITECT;
  if (role === DEFAULT_ROLES.REVIEWER) return ROLE_LABEL_COLORS.REVIEWER;

  return DEFAULT_ROLE_LABEL_COLOR;
}
