/**
 * projection/metadata.ts — Managed body metadata block helpers.
 */
import type { ProjectionMetadata } from "./types.js";

export const ISSUE_METADATA_PREFIX = "<!-- devclaw:issue-metadata ";
export const ISSUE_METADATA_SUFFIX = " -->";
const ISSUE_METADATA_RE = /<!-- devclaw:issue-metadata (\{.*?\}) -->/s;

export function renderIssueMetadata(metadata: ProjectionMetadata): string {
  return `${ISSUE_METADATA_PREFIX}${JSON.stringify(metadata)}${ISSUE_METADATA_SUFFIX}`;
}

export function extractIssueMetadata(body: string): ProjectionMetadata | null {
  const match = ISSUE_METADATA_RE.exec(body);

  if (!match) return null;
  try {
    const raw = match[1];

    if (!raw) return null;
    const data: unknown = JSON.parse(raw);

    return isProjectionMetadata(data) ? data : null;
  } catch {
    return null;
  }
}

export function replaceIssueMetadata(body: string, metadata: ProjectionMetadata): string {
  const rendered = renderIssueMetadata(metadata);

  if (ISSUE_METADATA_RE.test(body)) {
    return body.replace(ISSUE_METADATA_RE, rendered);
  }

  return body.trim().length > 0 ? `${body.trimEnd()}\n\n${rendered}` : rendered;
}

export function metadataMatches(metadata: ProjectionMetadata | null, expected: ProjectionMetadata): boolean {
  if (!metadata) return false;

  return metadata.projectSlug === expected.projectSlug
    && metadata.issueId === expected.issueId
    && metadata.projectionVersion === expected.projectionVersion;
}

function isProjectionMetadata(value: unknown): value is ProjectionMetadata {
  if (typeof value !== "object" || value === null) return false;
  if (!("projectSlug" in value) || typeof value.projectSlug !== "string" || !value.projectSlug) return false;
  if (!("issueId" in value) || typeof value.issueId !== "number" || !Number.isSafeInteger(value.issueId)) return false;
  if (!("projectionVersion" in value) || typeof value.projectionVersion !== "number" || !Number.isSafeInteger(value.projectionVersion)) return false;
  if ("stateRef" in value && value.stateRef !== undefined && typeof value.stateRef !== "string") return false;
  if ("managedAt" in value && value.managedAt !== undefined && typeof value.managedAt !== "string") return false;

  return true;
}
