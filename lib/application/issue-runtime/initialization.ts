/** Interprets provider labels only for a previously absent runtime record. */
import { type IssueRuntimeState, REVIEW_POLICY, ROUTING_LABELS, TEST_POLICY } from "../../domain/index.js";
import { buildInitialIssueRuntimeState } from "./creation.js";
import type { IssueStateWriteInput } from "./types.js";

/** Build a new record from explicit inputs and projection values allowed by resolved roles.
 * No role registry means no inferred assignment; lifecycle callers can supply explicit choices.
 * @param input - Initialization choices and optional resolved role definitions for label import.
 * @param workflow - Validated canonical state and label selected for the initial record.
 */
export function initializeRuntimeFromProjection(
  input: IssueStateWriteInput,
  workflow: Pick<IssueRuntimeState, "workflowState" | "workflowLabel">,
): IssueRuntimeState {
  const labels = new Set(input.issue.labels);
  const assignments = Object.entries(input.initializationRoles ?? {}).flatMap(([role, config]) =>
    Object.keys(config.levels).filter((level) => labels.has(`${role}:${level}`)
      && (input.assignedRole === undefined || input.assignedRole === role)
      && (input.assignedLevel === undefined || input.assignedLevel === level)).map((level) => ({ role, level })));

  if ((input.assignedRole === undefined || input.assignedLevel === undefined) && assignments.length > 1) {
    throw new Error("Provider labels contain multiple configured role/level assignments; explicit initialization choices are required.");
  }

  const assignment = assignments[0];
  const reviewPolicies = [
    ...(labels.has(ROUTING_LABELS.REVIEW_HUMAN) ? [REVIEW_POLICY.HUMAN] : []),
    ...(labels.has(ROUTING_LABELS.REVIEW_AGENT) ? [REVIEW_POLICY.AGENT] : []),
    ...(labels.has(ROUTING_LABELS.REVIEW_SKIP) ? [REVIEW_POLICY.SKIP] : []),
  ];
  const testPolicies = [
    ...(labels.has(ROUTING_LABELS.TEST_AGENT) ? [TEST_POLICY.AGENT] : []),
    ...(labels.has(ROUTING_LABELS.TEST_SKIP) ? [TEST_POLICY.SKIP] : []),
  ];

  if ((input.reviewPolicy === undefined && reviewPolicies.length > 1)
    || (input.testPolicy === undefined && testPolicies.length > 1)) {
    throw new Error("Provider labels contain conflicting routing policies; explicit initialization choices are required.");
  }

  return buildInitialIssueRuntimeState({
    provider: input.providerType,
    ...workflow,
    assignedRole: input.assignedRole !== undefined ? input.assignedRole : assignment?.role ?? null,
    assignedLevel: input.assignedLevel !== undefined ? input.assignedLevel : assignment?.level ?? null,
    owner: input.owner ?? null,
    reviewPolicy: input.reviewPolicy !== undefined ? input.reviewPolicy : reviewPolicies[0] ?? null,
    testPolicy: input.testPolicy !== undefined ? input.testPolicy : testPolicies[0] ?? null,
    notifyTarget: input.notifyTarget ?? null,
  }, input.project.slug, input.issue.iid);
}
