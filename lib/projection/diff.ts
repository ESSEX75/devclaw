/**
 * projection/diff.ts — Deterministic managed label diffs.
 */
import { expectedManagedLabels, isManagedLabel } from "./labels.js";
import type { ProjectionDiff, ProjectionInput } from "./types.js";

export function diffIssueProjection(input: ProjectionInput): ProjectionDiff {
  const expected = expectedManagedLabels(input.state);
  const actualManaged = input.actualLabels
    .filter((label) => isManagedLabel(label, input.options))
    .sort();
  const unmanaged = input.actualLabels
    .filter((label) => !isManagedLabel(label, input.options))
    .sort();

  return {
    expectedManagedLabels: expected,
    actualManagedLabels: actualManaged,
    unmanagedLabels: unmanaged,
    missingManagedLabels: expected.filter((label) => !actualManaged.includes(label)),
    unexpectedManagedLabels: actualManaged.filter((label) => !expected.includes(label)),
  };
}
