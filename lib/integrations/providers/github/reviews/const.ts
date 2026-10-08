/** Owns github/reviews const contracts at the concrete provider boundary. */

/** Formal review resource owned by review observations. */
export const GITHUB_REVIEW_RESOURCE = {
  REVIEWS: "reviews",
} as const;

/** Login suffix identifying provider bot accounts in GitHub review observations. */
export const GITHUB_REVIEW_BOT_SUFFIX = "[bot]";
