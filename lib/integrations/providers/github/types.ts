/** Owns validated internal GitHub DTOs shared by concrete capabilities. */

import type {
  z,
} from "zod";

import type {
  GhCommentSchema,
  GhIssueSchema,
  GhPullRequestSchema,
} from "./schema.js";

/** Issue fields validated at the GitHub CLI boundary. */
export type GhIssue = z.infer<typeof GhIssueSchema>;

/** Internal confirmed PR DTO inferred from the owning boundary schema. */
export type GhPullRequest = z.infer<typeof GhPullRequestSchema>;

/** Confirmed repository identity shared by discovery and attachments. */
export type GitHubRepositoryInfo = {
  /** Provider-confirmed repository owner login. */
  owner: string;
  /** Provider-confirmed repository name. */
  name: string;
};

/** Validated human conversation comment, including cosmetic reaction evidence. */
export type GhConversationComment = z.infer<typeof GhCommentSchema>;
