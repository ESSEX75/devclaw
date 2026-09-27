/** Applies each issue's saved policy without importing current configuration defaults. */

import { DEFAULT_ROLES, type IssueRuntimeState, REVIEW_POLICY, TEST_POLICY } from "../../domain/index.js";
import { QUEUE_REASON } from "./const.js";

/** Explain why the saved policy forbids this built-in role; custom roles remain eligible.
 * Null snapshots retain their existing unrestricted meaning and never inherit changed defaults.
 * @param state - Authoritative issue policy snapshot.
 * @param role - Configured candidate role.
 */
export function queuePolicyBlock(state: IssueRuntimeState, role: string): typeof QUEUE_REASON.REVIEW_POLICY | typeof QUEUE_REASON.TEST_POLICY | null {
  if (role === DEFAULT_ROLES.REVIEWER && (state.reviewPolicy === REVIEW_POLICY.HUMAN || state.reviewPolicy === REVIEW_POLICY.SKIP)) {
    return QUEUE_REASON.REVIEW_POLICY;
  }

  if (role === DEFAULT_ROLES.TESTER && state.testPolicy === TEST_POLICY.SKIP) return QUEUE_REASON.TEST_POLICY;

  return null;
}
