/** Defines validated GitHub associated request discovery contracts shared with capability consumers. */

import type { z } from "zod";

import type { ValueOf } from "../../../../types.js";
import type { GITHUB_DISCOVERY_STATE } from "./const.js";
import type { GhPullRequestSchema } from "./schema.js";

/** Internal confirmed PR DTO inferred from the owning boundary schema. */
export type GhPullRequest = z.infer<typeof GhPullRequestSchema>;

/** Native/fallback lifecycle filter derived from the concrete discovery registry. */
export type GhDiscoveryState = ValueOf<typeof GITHUB_DISCOVERY_STATE>;
