/** Owns GitLab associated request discovery identifiers and policies used by this capability. */

/** Associated-request endpoint owned by discovery. */
export const GITLAB_DISCOVERY_RESOURCE = {
  RELATED_MERGE_REQUESTS: "related_merge_requests",
} as const;

/** Merge conflict/readiness evidence supplied by GitLab. */
export const GITLAB_MERGEABILITY = {
  CONFLICT: "conflict",
  MERGEABLE: "mergeable",
  CI_REQUIRED: "ci_must_pass",
} as const;
