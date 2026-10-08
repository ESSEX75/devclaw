/** Owns github/health schema contracts at the concrete provider boundary. */

import { z } from "zod";

/** Validates GhRateLimitSchema provider payloads. */
export const GhRateLimitSchema = z.object({
  resources: z.object({ core: z.object({ remaining: z.number().int().nonnegative(), reset: z.number() }) }),
});
