/** Owns gitlab/issues schema contracts at the concrete provider boundary. */

import { z } from "zod";

import { ProviderIdentitySchema } from "../../transport/index.js";

/** Validates GitLabIssueSchema provider payloads. */
export const GitLabIssueSchema = z.object({
  iid: ProviderIdentitySchema, title: z.string(), description: z.string().nullable().transform(value => value ?? ""), labels: z.array(z.string()),
  state: z.string(), web_url: z.string(),
});
