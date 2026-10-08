/** Owns GitLab attachment publication identifiers and policies used by this capability. */

/** GitLab resource paths resolved against confirmed installation/project context. */
export const GITLAB_UPLOAD_PATH = {
  API: "/api/v4/projects/",
  ENDPOINT: "/uploads",
  FILES: "/uploads/",
  PROJECT: "/-/project/",
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
