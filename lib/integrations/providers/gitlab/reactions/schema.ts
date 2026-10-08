/** Validates GitLab cosmetic reaction observations responses before untrusted data enters the owning capability. */

import { z } from "zod";

/** Cosmetic emoji metadata returned in complete reaction collections. */
export const GitLabEmojiSchema = z.object({ name: z.string() });
