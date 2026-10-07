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
