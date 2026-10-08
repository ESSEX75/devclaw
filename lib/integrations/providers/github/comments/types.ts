/** Owns github/comments types contracts at the concrete provider boundary. */

import type { z } from "zod";

import type { GhCommentSchema } from "./schema.js";

/** Validated human conversation comment, including cosmetic reaction evidence. */
export type GhConversationComment = z.infer<typeof GhCommentSchema>;
