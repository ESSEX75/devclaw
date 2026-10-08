/** Validates GitHub comment and note observations responses before untrusted data enters the owning capability. */

import { z } from "zod";

/** Conversation comments retain cosmetic reaction counts independently of summary receipts. */
export const GhCommentSchema = z.object({ id: z.number().int().positive().safe(), user: z.object({ login: z.string() }), body: z.string(), created_at: z.string(),
  reactions: z.object({ eyes: z.number().nonnegative().optional() }).optional() });

/** Inline review comments have a namespace distinct from summaries and conversations. */
export const GhInlineSchema = GhCommentSchema.extend({ path: z.string().optional(), line: z.number().nullable().optional() });
