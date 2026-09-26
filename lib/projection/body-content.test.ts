/** Checks replacement of copied or forged managed body blocks while retaining trusted creation identity. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { composeManagedIssueBody } from "./body-content.js";
import { extractIssueCreationMarker, extractIssueMetadata, renderIssueCreationMarker, replaceIssueMetadata } from "./metadata.js";

it("replaces all submitted managed blocks and remains idempotent for empty user content", () => {
  const metadata = { projectSlug: "trusted-project", issueId: 42, projectionVersion: 1 };
  const operation = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const supplied = replaceIssueMetadata("User content", { ...metadata, projectSlug: "foreign-project" })
    + "\n<!-- devclaw:issue-metadata broken -->\n" + renderIssueCreationMarker("ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee");
  const composed = composeManagedIssueBody(supplied, metadata, operation);
  assert.deepEqual(extractIssueMetadata(composed), metadata);
  assert.equal(extractIssueCreationMarker(composed), operation);
  assert.equal(composed.match(/devclaw:issue-metadata/g)?.length, 1);
  assert.equal(composed.match(/devclaw:issue-creation/g)?.length, 1);
  assert.ok(composed.startsWith("User content"));
  const empty = composeManagedIssueBody("", metadata, operation);
  assert.equal(composeManagedIssueBody(empty, metadata, operation), empty);
});
