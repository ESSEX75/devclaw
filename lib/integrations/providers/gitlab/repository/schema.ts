/** Validates GitLab confirmed repository identity responses before untrusted data enters the owning capability. */

import { z } from "zod";

import { ProviderIdentitySchema } from "../../transport/index.js";

/** Confirmed project identity used to fence project-local merge-request IIDs. */
export const GitLabProjectIdentitySchema = z.object({ id: ProviderIdentitySchema });
