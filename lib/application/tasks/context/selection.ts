/** Selects bounded worker discussion without summarizing or silently dropping required input. */

import type { IssueComment } from "../../../integrations/providers/index.js";
import { TASK_COMMENT_LIMIT, TASK_CONTEXT_BUDGET } from "./const.js";
import { buildTaskMessage } from "./message-builder.js";
import type { SelectTaskContextInput, TaskContextBudget, TaskContextSelection } from "./types.js";

//TODO: Sort out the comment transmission
/** Estimate input conservatively using one UTF-8 byte per token, without claiming tokenizer accuracy.
 * @param taskMessage - Complete rendered task input.
 * @param roleInstructions - Additional worker system instructions.
 */
export function estimateTaskInputTokens(taskMessage: string, roleInstructions: string): number {
  return Buffer.byteLength(taskMessage, "utf8") + Buffer.byteLength(roleInstructions, "utf8");
}

/** Resolve a valid input allowance; this policy does not describe a model's actual context window.
 * @param budget - Optional explicit estimate and withheld capacity.
 */
function availableInputTokens(budget?: TaskContextBudget): number {
  const max = budget?.maxInputTokens ?? TASK_CONTEXT_BUDGET.MAX_INPUT_TOKENS;
  const reserved = budget?.reservedTokens ?? TASK_CONTEXT_BUDGET.RESERVED_TOKENS;

  if (!Number.isSafeInteger(max) || !Number.isSafeInteger(reserved) || reserved < 0 || max <= reserved) {
    throw new Error("Task context budget requires a positive safe integer allowance greater than its nonnegative reserve.");
  }

  return max - reserved;
}

/** Reject oversized required input before dispatch reserves a worker or submits a turn.
 * @param taskMessage - Rendered input, including omission notices.
 * @param roleInstructions - Additional worker system instructions.
 * @param budget - Optional explicit estimate and withheld capacity.
 */
export function assertTaskInputFits(taskMessage: string, roleInstructions: string, budget?: TaskContextBudget): void {
  const available = availableInputTokens(budget);
  const estimate = estimateTaskInputTokens(taskMessage, roleInstructions);

  if (estimate > available) {
    throw new Error(
      `Required task context exceeds the input budget (${estimate} estimated tokens; ${available} available). `
      + "Reduce the issue description, instructions, PR feedback, or attachment context before dispatch.",
    );
  }
}

/** Render selected discussion and account for notices in the same input estimate.
 * @param input - Required sections, original comments, and input policy.
 * @param rendered - Full comments and any marked fragment displayed to the worker.
 * @param complete - Original full comments eligible for acknowledgement.
 * @param truncated - Number of comments represented by fragments.
 */
function renderSelection(
  input: SelectTaskContextInput, rendered: IssueComment[], complete: IssueComment[], truncated: number,
): TaskContextSelection {
  const omitted = input.comments.length - rendered.length;
  const notice = omitted || truncated
    ? `Discussion is incomplete: ${omitted} comments omitted; ${truncated} comments truncated. Read the original discussion at ${input.message.issueUrl} for missing context.`
    : undefined;
  const taskMessage = buildTaskMessage({ ...input.message, comments: rendered, discussionNotice: notice });
  const estimatedInputTokens = estimateTaskInputTokens(taskMessage, input.roleInstructions);

  return {
    taskMessage, comments: complete, omittedCommentCount: omitted, truncatedCommentCount: truncated,
    estimatedInputTokens, mandatoryPartsExceedBudget: estimatedInputTokens > availableInputTokens(input.budget),
  };
}

/** Keep a recent contiguous suffix, then at most one marked fragment of its preceding comment.
 * Full required sections and omission notices are never truncated. An over-budget empty
 * selection reports a blocking result. Returned acknowledgement candidates exclude fragments.
 * @param input - Required task input, original discussion, and optional estimate policy.
 */
export function selectTaskContext(input: SelectTaskContextInput): TaskContextSelection {
  availableInputTokens(input.budget);
  const recent = input.comments.slice(-TASK_COMMENT_LIMIT);
  const allRecent = renderSelection(input, recent, recent, 0);

  if (!allRecent.mandatoryPartsExceedBudget) return allRecent;
  let selected = renderSelection(input, [], [], 0);

  if (selected.mandatoryPartsExceedBudget) return selected;
  const complete: IssueComment[] = [];

  for (let index = recent.length - 1; index >= 0; index--) {
    const comment = recent[index];
    const candidate = renderSelection(input, [comment, ...complete], [comment, ...complete], 0);

    if (!candidate.mandatoryPartsExceedBudget) {
      complete.unshift(comment);
      selected = candidate;
      continue;
    }

    const characters = Array.from(comment.body);
    let low = 1;
    let high = characters.length - 1;

    while (low <= high) {
      const length = Math.floor((low + high) / 2);
      const body = `${characters.slice(0, length).join("")}\n[Comment truncated. Read the full original at ${input.message.issueUrl} before acting.]`;
      const fragment = renderSelection(input, [{ ...comment, body }, ...complete], complete, 1);

      if (fragment.mandatoryPartsExceedBudget) {
        high = length - 1;
      } else {
        selected = fragment;
        low = length + 1;
      }
    }

    break;
  }

  return selected;
}
