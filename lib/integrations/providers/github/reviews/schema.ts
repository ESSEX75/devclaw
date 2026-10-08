/** Owns github/reviews schema contracts at the concrete provider boundary. */

import { z } from "zod";

/** Review summaries carry timestamps for selecting the latest formal decision per reviewer. */
export const GhReviewSchema = z.object({ id: z.number().int().positive().safe(), user: z.object({ login: z.string() }),
  body: z.string().nullable().optional().transform(value => value ?? ""), state: z.string(),
  submitted_at: z.string().refine(value => Number.isFinite(Date.parse(value)), "Invalid review timestamp.").nullable() });
