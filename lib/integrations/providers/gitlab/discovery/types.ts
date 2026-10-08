/** Owns gitlab/discovery types contracts at the concrete provider boundary. */

import type { z } from "zod";

import type { GitLabMRSchema } from "./schema.js";

/** Validated related-request DTO used by every GitLab capability. */
export type GitLabMR = z.infer<typeof GitLabMRSchema>;
