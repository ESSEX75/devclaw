/** Managed body block patterns used when rebuilding user-editable descriptions. */

/** All metadata blocks, including invalid payloads that require replacement. */
export const ISSUE_BODY_METADATA_BLOCKS = /<!-- devclaw:issue-metadata\b[\s\S]*?-->/g;

/** All creation markers submitted with user content; only the trusted identity is restored. */
export const ISSUE_BODY_CREATION_BLOCKS = /<!-- devclaw:issue-creation\b[\s\S]*?-->/g;
