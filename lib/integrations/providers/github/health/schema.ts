/** Validates GitHub authentication and quota observations responses before untrusted data enters the owning capability. */

import { z } from "zod";

/** Validates GhRateLimitSchema provider payloads. */
export const GhRateLimitSchema = z.object({
  resources: z.object({ core: z.object({ remaining: z.number().int().nonnegative(), reset: z.number() }) }),
});
