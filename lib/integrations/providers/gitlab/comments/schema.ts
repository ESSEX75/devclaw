/** Owns gitlab/comments schema contracts at the concrete provider boundary. */

import { z } from "zod";

/** GitLab notes keep one shared identity across discussion and conversation endpoints. */
export const GitLabNoteSchema = z.object({ id: z.number().int().positive().safe(), author: z.object({ username: z.string() }), body: z.string(),
  created_at: z.string(), system: z.boolean(), resolvable: z.boolean().optional(), resolved: z.boolean().optional(),
  type: z.string().nullable().optional(),
  position: z.object({ new_path: z.string().optional(), new_line: z.number().nullable().optional() }).nullable().optional() });
