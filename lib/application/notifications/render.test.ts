/** Verifies review messages report the workflow state actually committed. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOTIFICATION_EVENT } from "./const.js";
import { renderNotificationMessage } from "./render.js";

describe("review notification rendering", () => {
  it("reports the rejected state after an unmerged PR closes", () => {
    const message = renderNotificationMessage({
      type: NOTIFICATION_EVENT.PR_CLOSED,
      project: "project", issueId: 42, issueTitle: "Review", issueUrl: "https://example.test/issues/42",
      prUrl: "https://example.test/pull/7", nextState: "Rejected",
    });

    assert.match(message, /→ Rejected/);
    assert.doesNotMatch(message, /To Improve/);
    assert.match(message, /Pull Request #7/);
  });

  it("reports a configured feedback target without assuming a built-in queue", () => {
    const message = renderNotificationMessage({
      type: NOTIFICATION_EVENT.MERGE_CONFLICT,
      project: "project", issueId: 42, issueTitle: "Review", issueUrl: "https://example.test/issues/42",
      nextState: "Awaiting Rebase",
    });

    assert.match(message, /→ Awaiting Rebase/);
    assert.equal(message.match(/Issue #42/g)?.length, 1);
  });
});
