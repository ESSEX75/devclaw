/** Validates untrusted OpenClaw scope command responses before setup uses them. */
import { z } from "zod";

/** Known response fields; unknown transport metadata is ignored. */
export const scopeCommandSchema = z.object({
  ok: z.boolean().optional(),
  status: z.string().optional(),
  approved: z.array(z.string()).optional(),
  missing: z.array(z.string()).optional(),
  requestId: z.string().optional(),
  message: z.string().optional(),
});
