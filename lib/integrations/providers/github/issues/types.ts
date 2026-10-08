/** Owns github/issues types contracts at the concrete provider boundary. */

import type { z } from "zod";

import type { GhIssueSchema } from "./schema.js";

/** Issue fields validated at the GitHub CLI boundary. */
export type GhIssue = z.infer<typeof GhIssueSchema>;
