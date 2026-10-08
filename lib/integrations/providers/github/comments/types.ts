/** Defines validated GitHub comment and note observations contracts shared with capability consumers. */

import type { z } from "zod";

import type { GhCommentSchema, GhInlineSchema } from "./schema.js";

/** Validated human conversation comment, including cosmetic reaction evidence. */
export type GhConversationComment = z.infer<typeof GhCommentSchema>;

/** Validated inline feedback retains its source identity, optional location and cosmetic reactions. */
export type GhInlineComment = z.infer<typeof GhInlineSchema>;
