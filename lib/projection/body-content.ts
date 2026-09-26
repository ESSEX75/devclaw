/** Rebuilds managed body blocks while preserving only caller-editable issue content. */
import { ISSUE_BODY_CREATION_BLOCKS, ISSUE_BODY_METADATA_BLOCKS } from "./const.js";
import { renderIssueCreationMarker, replaceIssueMetadata } from "./metadata.js";
import type { ProjectionMetadata } from "./types.js";

/** Replace user content without allowing submitted managed blocks to override local truth.
 * Every existing or submitted managed block is removed before appending one authoritative block.
 * @param userBody - Requested user content, possibly copied from a provider body.
 * @param metadata - Authoritative metadata derived from local runtime state.
 * @param creationOperationId - Durable creation identity retained across edits when present.
 */
export function composeManagedIssueBody(userBody: string, metadata: ProjectionMetadata, creationOperationId?: string | null): string {
  let content = userBody.replace(ISSUE_BODY_METADATA_BLOCKS, "").replace(ISSUE_BODY_CREATION_BLOCKS, "").trimEnd();

  if (creationOperationId) {
    const marker = renderIssueCreationMarker(creationOperationId);

    content = content ? `${content}\n\n${marker}` : marker;
  }

  return replaceIssueMetadata(content, metadata);
}
