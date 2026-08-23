/**
 * workflow/labels.ts — Label formatting, detection, and routing helpers.
 */
import {
  DEFAULT_ROLE_LABEL_COLOR,
  DEFAULT_ROLES,
  REVIEW_POLICY,
  ROLE_LABEL_COLORS,
  ROUTING_LABELS,
  STEP_ROUTING_COLOR,
  TEST_POLICY,
} from "./const.js";
import type { ReviewPolicy, RoleDefinition, RoleId, RoutingLabel, TestPolicy } from "./types.js";

// ---------------------------------------------------------------------------
// Step routing labels
// ---------------------------------------------------------------------------

/** Known step routing labels (created on the provider during project registration). */
const STEP_ROUTING_LABELS: readonly string[] = Object.values(ROUTING_LABELS);

// ---------------------------------------------------------------------------
// Notify labels — channel routing for notifications
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Owner labels — instance identity on issues
// ---------------------------------------------------------------------------


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
  roles: Partial<Record<RoleId, RoleDefinition>>,
): Array<{ name: string; color: string }> {
  const labels: Array<{ name: string; color: string }> = [];

  for (const [roleId, role] of Object.entries(roles)) {
    if (!role) continue;
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
  if (role === DEFAULT_ROLES.DEVELOPER) return ROLE_LABEL_COLORS.DEVELOPER;
  if (role === DEFAULT_ROLES.TESTER) return ROLE_LABEL_COLORS.TESTER;
  if (role === DEFAULT_ROLES.ARCHITECT) return ROLE_LABEL_COLORS.ARCHITECT;
  if (role === DEFAULT_ROLES.REVIEWER) return ROLE_LABEL_COLORS.REVIEWER;

  return DEFAULT_ROLE_LABEL_COLOR;
}
