/** Defines validated GitLab associated request discovery contracts shared with capability consumers. */

import type { z } from "zod";

import type { GitLabMRSchema } from "./schema.js";

/** Validated related-request DTO used by every GitLab capability. */
export type GitLabMR = z.infer<typeof GitLabMRSchema>;
