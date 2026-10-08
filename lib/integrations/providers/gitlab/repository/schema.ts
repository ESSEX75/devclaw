/** Owns gitlab/repository schema contracts at the concrete provider boundary. */

import { z } from "zod";

import { ProviderIdentitySchema } from "../../transport/index.js";

/** Confirmed project identity used to fence project-local merge-request IIDs. */
export const GitLabProjectIdentitySchema = z.object({ id: ProviderIdentitySchema });
