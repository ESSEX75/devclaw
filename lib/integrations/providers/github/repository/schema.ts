/** Validates GitHub confirmed repository identity responses before untrusted data enters the owning capability. */

import { z } from "zod";

/** Validates repository identity before a successful observation enters the instance cache. */
export const GhRepositorySchema = z.object({ owner: z.object({ login: z.string().min(1) }), name: z.string().min(1) });
