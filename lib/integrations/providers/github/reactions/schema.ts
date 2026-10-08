/** Owns github/reactions schema contracts at the concrete provider boundary. */

import { z } from "zod";

/** Complete cosmetic reaction payload used only as an indicator, never a durable receipt. */
export const GhReactionSchema = z.object({ content: z.string() });
