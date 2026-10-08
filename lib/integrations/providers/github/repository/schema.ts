/** Owns github/repository schema contracts at the concrete provider boundary. */

import { z } from "zod";

/** Validates repository identity before a successful observation enters the instance cache. */
export const GhRepositorySchema = z.object({ owner: z.object({ login: z.string().min(1) }), name: z.string().min(1) });
