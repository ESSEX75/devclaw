/** Inputs used to render worker task context without I/O. */

import type { IssueComment } from "../../../integrations/providers/index.js";
import type { ResolvedRoleConfig } from "../../../state/index.js";
import type { PrContext, PrFeedback } from "../../review/pr-context.js";

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
  /** Effective role configuration determining completion results and level presentation. */
  resolvedRole?: ResolvedRoleConfig;
  /** Current pull-request context, when available. */
  prContext?: PrContext;
  /** Actionable pull-request feedback for a returning worker. */
  prFeedback?: PrFeedback;
  /** Pre-formatted attachment context string (from formatAttachmentsForTask) */
  attachmentContext?: string;
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
