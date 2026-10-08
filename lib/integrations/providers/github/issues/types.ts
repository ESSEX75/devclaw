/** Defines validated GitHub issue observations and explicit mutations contracts shared with capability consumers. */

import type { z } from "zod";

import type { GhIssueSchema } from "./schema.js";

/** Issue fields validated at the GitHub CLI boundary. */
export type GhIssue = z.infer<typeof GhIssueSchema>;
