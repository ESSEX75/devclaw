/** Inputs used to render worker task context without I/O. */

import type { IssueComment } from "../../../integrations/providers/contracts/index.js";
import type { ResolvedRoleConfig } from "../../../state/index.js";
import type { PrContext, PrFeedback } from "../../review/index.js";

/** Inputs consumed by buildTaskMessage after adapter validation. */
export type BuildTaskMessageInput = {
  /** Project display name included in worker context. */
  projectName: string;
  /** Persisted notification destination used to resolve exactly one project. */
  channelId: string;
  /** Configured role responsible for the workflow state or worker task. */
  role: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Provider title used for task context and operator output. */
  issueTitle: string;
  /** Provider description used for worker context or level selection. */
  issueDescription: string;
  /** Provider issue URL included in worker context. */
  issueUrl: string;
  /** Repository location for the worker checkout. */
  repo: string;
  /** Configured integration branch targeted by the task. */
  baseBranch: string;
  /** Recent provider discussion considered when rendering worker context. */
  comments?: Pick<IssueComment, "author" | "body" | "created_at">[];
  /** Explicit omission/truncation notice produced by the context selector. */
  discussionNotice?: string;
  /** Effective role configuration determining completion results and level presentation. */
  resolvedRole?: ResolvedRoleConfig;
  /** Current pull-request context, when available. */
  prContext?: PrContext;
  /** Actionable pull-request feedback for a returning worker. */
  prFeedback?: PrFeedback;
  /** Pre-formatted attachment context string (from formatAttachmentsForTask) */
  attachmentContext?: string;
};

/** Estimated task input allowance, independent of an existing session's occupancy. */
export type TaskContextBudget = {
  /** Total estimate available to the task input and reserved capacity. */
  maxInputTokens: number;
  /** Capacity withheld from the task for additional prompts and worker operation. */
  reservedTokens: number;
};

/** Required task sections and discussion considered by the deterministic selector. */
export type SelectTaskContextInput = {
  /** Required message sections; discussion is selected separately. */
  message: Omit<BuildTaskMessageInput, "comments" | "discussionNotice">;
  /** Provider discussion in oldest-to-newest order. */
  comments: IssueComment[];
  /** Extra system instructions included in the same input estimate. */
  roleInstructions: string;
  /** Optional explicit input allowance; package defaults apply when absent. */
  budget?: TaskContextBudget;
};

/** Rendered input and exact full comments eligible for acknowledgement. */
export type TaskContextSelection = {
  /** Task message including any visible discussion omissions. */
  taskMessage: string;
  /** Original comments included in full; fragments never qualify. */
  comments: IssueComment[];
  /** Number of original comments omitted entirely. */
  omittedCommentCount: number;
  /** Number of comments represented by an explicitly marked fragment. */
  truncatedCommentCount: number;
  /** Conservative UTF-8 byte-based estimate for message plus role instructions. */
  estimatedInputTokens: number;
  /** Required sections cannot fit; dispatch must fail before reservation. */
  mandatoryPartsExceedBudget: boolean;
};

/** Inputs consumed by buildConflictFixMessage after adapter validation. */
export type BuildConflictFixMessageInput = {
  /** Project display name included in worker context. */
  projectName: string;
  /** Persisted notification destination used to resolve exactly one project. */
  channelId: string;
  /** Configured role responsible for the workflow state or worker task. */
  role: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Provider title used for task context and operator output. */
  issueTitle: string;
  /** Provider issue URL included in worker context. */
  issueUrl: string;
  /** Repository location for the worker checkout. */
  repo: string;
  /** Configured integration branch targeted by the task. */
  baseBranch: string;
  /** Effective role configuration determining completion results and level presentation. */
  resolvedRole?: ResolvedRoleConfig;
  /** Actionable pull-request feedback for a returning worker. */
  prFeedback: PrFeedback;
};
