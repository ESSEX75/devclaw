/** Owns gitlab/comments types contracts at the concrete provider boundary. */

import type { z } from "zod";

import type { GitLabNoteSchema } from "./schema.js";

/** Validated note observation shared between review sources. */
export type GitLabNote = z.infer<typeof GitLabNoteSchema>;
