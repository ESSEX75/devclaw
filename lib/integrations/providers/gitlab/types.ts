/** Owns validated internal GitLab DTOs shared by concrete capabilities. */

import type {
  z,
} from "zod";

import type {
  GitLabMRSchema,
  GitLabNoteSchema,
} from "./schema.js";

/** Validated related-request DTO used by every GitLab capability. */
export type GitLabMR = z.infer<typeof GitLabMRSchema>;

/** Validated note observation shared between review sources. */
export type GitLabNote = z.infer<typeof GitLabNoteSchema>;
