/** Defines validated GitLab comment and note observations contracts shared with capability consumers. */

import type { z } from "zod";

import type { GitLabNoteSchema } from "./schema.js";

/** Validated note observation shared between review sources. */
export type GitLabNote = z.infer<typeof GitLabNoteSchema>;
