/** Owns gitlab/reactions schema contracts at the concrete provider boundary. */

import { z } from "zod";

/** Cosmetic emoji metadata returned in complete reaction collections. */
export const GitLabEmojiSchema = z.object({ name: z.string() });
