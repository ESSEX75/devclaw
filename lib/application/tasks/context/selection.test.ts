/** Exercises budgeted discussion selection and preservation of required worker input. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IssueComment } from "../../../integrations/providers/contracts/index.js";
import { buildTaskMessage } from "./message-builder.js";
import { assertTaskInputFits, selectTaskContext } from "./selection.js";
import type { SelectTaskContextInput } from "./types.js";

/** Construct a task with visible required sections and a small explicit input allowance.
 * @param comments - Discussion in chronological order.
 */
function taskInput(comments: IssueComment[]): SelectTaskContextInput {
  return {
    message: {
      projectName: "Project", channelId: "channel", role: "developer", issueId: 1,
      issueTitle: "Required title", issueDescription: "Required description",
      issueUrl: "https://example.test/issues/1", repo: "repo", baseBranch: "main",
      attachmentContext: "Required attachment context",
    },
    comments, roleInstructions: "System instructions",
    budget: { maxInputTokens: 3_000, reservedTokens: 500 },
  };
}

/** Construct original provider discussion with stable identity.
 * @param id - Provider comment identifier.
 * @param body - Unmodified provider comment text.
 */
function comment(id: number, body: string): IssueComment {
  return { id, author: "reviewer", body, created_at: "2026-01-01T00:00:00Z" };
}

describe("budgeted task context", () => {
  it("preserves full discussion and required sections when they fit", () => {
    const input = taskInput([comment(1, "First decision"), comment(2, "Latest decision")]);
    const result = selectTaskContext(input);

    assert.deepEqual(result.comments, input.comments);
    assert.equal(result.omittedCommentCount, 0);
    assert.equal(result.truncatedCommentCount, 0);
    assert.equal(result.mandatoryPartsExceedBudget, false);
    assert.match(result.taskMessage, /Required description/);
    assert.match(result.taskMessage, /Required attachment context/);
    assert.match(result.taskMessage, /MANDATORY: Task Completion/);
    assert.ok(result.taskMessage.indexOf("First decision") < result.taskMessage.indexOf("Latest decision"));
  });

  it("marks a Unicode fragment and excludes it from acknowledgement while retaining newer comments", () => {
    const comments = [comment(1, "Old hidden history"), comment(2, "🙂 Важное решение ".repeat(1_000)), comment(3, "Newest instruction")];
    const input = taskInput(comments);
    const result = selectTaskContext(input);

    assert.deepEqual(result.comments.map((item) => item.id), [3]);
    assert.equal(result.omittedCommentCount, 1);
    assert.equal(result.truncatedCommentCount, 1);
    assert.match(result.taskMessage, /Comment truncated/);
    assert.match(result.taskMessage, /https:\/\/example.test\/issues\/1/);
    assert.match(result.taskMessage, /Newest instruction/);
    assert.doesNotMatch(result.taskMessage, /Old hidden history|\uFFFD/);
    assert.ok(result.estimatedInputTokens <= 2_500);
    assert.equal(comments[1].body, "🙂 Важное решение ".repeat(1_000));
  });

  it("reports history excluded by the count cap even when size is small", () => {
    const input = taskInput(Array.from({ length: 23 }, (_, index) => comment(index + 1, `Decision ${index + 1}`)));
    const result = selectTaskContext({ ...input, budget: { maxInputTokens: 20_000, reservedTokens: 0 } });

    assert.deepEqual(result.comments.map((item) => item.id), Array.from({ length: 20 }, (_, index) => index + 4));
    assert.equal(result.omittedCommentCount, 3);
    assert.match(result.taskMessage, /3 comments omitted/);
  });

  it("includes role instructions and the reserve in the budget and rejects required overflow", () => {
    const input = taskInput([comment(1, "Discussion")]);
    const result = selectTaskContext({ ...input, roleInstructions: "System requirement ".repeat(500) });

    assert.equal(result.mandatoryPartsExceedBudget, true);
    assert.deepEqual(result.comments, []);
    assert.match(result.taskMessage, /Required description/);
    assert.throws(() => assertTaskInputFits(result.taskMessage, "System requirement ".repeat(500), input.budget), /exceeds the input budget/);
    assert.throws(() => selectTaskContext({ ...input, budget: { maxInputTokens: 500, reservedTokens: 500 } }), /budget requires/);
  });

  it("renders every explicitly supplied comment without a second hidden count limit", () => {
    const input = taskInput(Array.from({ length: 21 }, (_, index) => comment(index + 1, `Visible comment ${index + 1}`)));
    const message = buildTaskMessage({ ...input.message, comments: input.comments });

    assert.match(message, /Visible comment 1\n/);
    assert.match(message, /Visible comment 21/);
  });
});
