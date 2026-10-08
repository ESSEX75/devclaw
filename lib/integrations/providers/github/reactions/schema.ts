/** Validates GitHub cosmetic reaction observations responses before untrusted data enters the owning capability. */

import { z } from "zod";

/** Complete cosmetic reaction payload used only as an indicator, never a durable receipt. */
export const GhReactionSchema = z.object({ content: z.string() });
