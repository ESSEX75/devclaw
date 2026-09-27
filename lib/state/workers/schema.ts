/** Validates persisted worker resolutions before replay can authorize effects. */

import { z } from "zod";

import { WORKER_DELIVERY_RESOLUTION } from "../../domain/index.js";

/** Strict recovery record tied to a concrete provider issue and submission. */
export const WorkerResolutionSchema = z.object({
  deliveryId: z.string().uuid(), issueId: z.number().int().positive(), sessionKey: z.string().min(1),
  role: z.string().min(1), level: z.string().min(1), slotIndex: z.number().int().nonnegative(), startedAt: z.string(),
  decision: z.enum(WORKER_DELIVERY_RESOLUTION), reason: z.string().min(1),
  fromState: z.string().min(1), fromLabel: z.string().min(1), toState: z.string().min(1), toLabel: z.string().min(1),
  completed: z.boolean(),
}).strict();

/** One latest decision per issue; pending decisions cannot be replaced. */
export const WorkerResolutionStoreSchema = z.record(z.string(), WorkerResolutionSchema);
