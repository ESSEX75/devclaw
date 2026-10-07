/** Owns concrete gitlab protocol fields and resource identifiers. */

/** GitLab's explicit inline-note discriminator, independent of optional position fields. */
export const GITLAB_INLINE_NOTE_TYPE = "DiffNote";

/** GitLab resource paths resolved against confirmed installation/project context. */
export const GITLAB_UPLOAD_PATH = {
  API: "/api/v4/projects/",
  ENDPOINT: "/uploads",
  FILES: "/uploads/",
  PROJECT: "/-/project/",
} as const;

/** Repository/project placeholder root understood by the concrete CLI. */
export const GITLAB_API_ROOT = "projects/:id";

/** API resource identifiers shared by concrete capabilities. */
export const GITLAB_API_RESOURCE = {
  ISSUES: "issues",
  RELATED_MERGE_REQUESTS: "related_merge_requests",
  MERGE_REQUESTS: "merge_requests",
  NOTES: "notes",
  LABELS: "labels",
  AWARD_EMOJI: "award_emoji",
  DISCUSSIONS: "discussions",
  APPROVALS: "approvals",
} as const;

/** Temporary resources and cleanup bounds owned exclusively by GitLab multipart transport. */
export const GITLAB_ATTACHMENT_STORAGE = {
  TEMP_PREFIX: "devclaw-upload-",
  FILE_PREFIX: "attachment-",
  CREATE_FLAG: "wx",
  FILE_MODE: 0o600,
  CLEANUP_RETRIES: 3,
  CLEANUP_DELAY_MS: 100,
} as const;

/** Project upload resource pattern with an opaque secret and one filename. */
export const GITLAB_UPLOAD_PATH_PATTERN = /^\/uploads\/[a-fA-F0-9]{32}\/[^/?#\\]+$/;

/** Control characters cannot identify an externally published attachment filename. */
export const GITLAB_FILENAME_CONTROL_LIMIT = 32;

/** GitLab lifecycle values, distinct from application workflow states. */
export const GITLAB_REQUEST_STATE = {
  OPEN: "opened",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

/** Merge conflict/readiness evidence supplied by GitLab. */
export const GITLAB_MERGEABILITY = {
  CONFLICT: "conflict",
  MERGEABLE: "mergeable",
  CI_REQUIRED: "ci_must_pass",
} as const;
