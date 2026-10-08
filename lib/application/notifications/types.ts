/** Defines notification events, delivery receipts, runtime capability, and route options. */

import type { RunCommand } from "../../context.js";
import type { NotificationChannel, REVIEW_POLICY,ReviewPolicy } from "../../domain/index.js";
import type { MessageDeliveryOutcome, NotificationChannelRuntime } from "../../integrations/index.js";
import type { ValueOf } from "../../types.js";
import type { RouteConfig } from "../setup/index.js";
import type { WORKER_SESSION_ACTION } from "../workers/const.js";
import type { NOTIFICATION_BLOCKED, NOTIFICATION_EVENT, NOTIFICATION_MERGE_ACTOR } from "./const.js";

/** Per-event-type toggle. All default to true — set to false to suppress. */
export type NotificationConfig = Partial<Record<NotifyEvent["type"], boolean>>;

/** Application delivery decision, including explicit blocked and uncertain outcomes. */
export type NotificationDeliveryResult = MessageDeliveryOutcome | {
  /** Policy or routing prevented a send. */
  status: typeof NOTIFICATION_BLOCKED;
  /** No acceptance was observed. */
  delivered: false;
  /** Why delivery is blocked. */
  reason: string;
  /** No transport ran. */
  path?: never;
  /** No receipt exists. */
  messageId?: never;
};

/** Narrow runtime surface required by notification delivery. */
export type NotificationRuntime = {
  /** Current route configuration used to validate the exact binding. */
  config: {
    /** Read the runtime's current route configuration. */
    current(): RouteConfig;
  };
  /** Native channel capability owned by the OpenClaw integration. */
  channel: NotificationChannelRuntime;
};

/** One task created by a worker and linked in its completion message. */
export type NotificationCreatedTask = {
  /** Provider-local task issue identifier. */
  id: number;
  /** New task title. */
  title: string;
  /** Link to the task issue. */
  url: string;
};

/** Project and provider issue identity shared by lifecycle notifications. */
type NotificationIssue = {
  /** Project name shown in the notification. */
  project: string;
  /** Provider-local issue identifier shown to recipients. */
  issueId: number;
  /** Link to the provider issue. */
  issueUrl: string;
};

/** Identity including the current issue title. */
type NotificationTitledIssue = NotificationIssue & {
  /** Current issue title shown to recipients. */
  issueTitle: string;
};

/** Optional pull request URL shared by review notifications. */
type NotificationPullRequest = {
  /** Related pull request link. */
  prUrl?: string;
};

/** Terminal workflow completion notification. */
type PipelineCompleteEvent = NotificationTitledIssue & {
  /** Event discriminator selecting the message template. */
  type: typeof NOTIFICATION_EVENT.PIPELINE_COMPLETE;
  /** Final workflow label after the terminal transition. */
  terminalState: string;
  /** Optional pull request link related to completion. */
  pullRequestUrl?: string;
  /** Human-readable merge outcome. */
  mergeResult?: string;
  /** Human-readable test outcome. */
  testResult?: string;
  /** Whether the provider issue was closed. */
  issueClosed: boolean;
};

/** Worker session start or resume notification. */
type WorkerStartEvent = NotificationTitledIssue & {
  /** Event discriminator selecting the message template. */
  type: typeof NOTIFICATION_EVENT.WORKER_START;
  /** Configured worker role used in the message. */
  role: string;
  /** Resolved worker level when known. */
  level: string;
  /** Worker display name when available. */
  name?: string;
  /** Whether the worker session was created or resumed. */
  sessionAction: ValueOf<typeof WORKER_SESSION_ACTION>;
};

/** Worker completion notification, including optional created tasks. */
type WorkerCompleteEvent = NotificationIssue & NotificationPullRequest & {
  /** Event discriminator selecting the message template. */
  type: typeof NOTIFICATION_EVENT.WORKER_COMPLETE;
  /** Configured worker role used in the message. */
  role: string;
  /** Resolved worker level when known. */
  level?: string;
  /** Worker display name when available. */
  name?: string;
  /** Worker completion outcome, including custom configured results. */
  result: string;
  /** Worker supplied completion summary. */
  summary?: string;
  /** Workflow label selected after completion. */
  nextState?: string;
  /** Tasks created by the completing worker. */
  createdTasks?: NotificationCreatedTask[];
};

/** Request for the saved review recipient to inspect a PR. */
type ReviewNeededEvent = NotificationTitledIssue & NotificationPullRequest & {
  /** Event discriminator selecting the message template. */
  type: typeof NOTIFICATION_EVENT.REVIEW_NEEDED;
  /** Review recipient selected by policy. */
  routing: Exclude<ReviewPolicy, typeof REVIEW_POLICY.SKIP>;
};

/** Completed pull request merge notification. */
type PullRequestMergedEvent = NotificationTitledIssue & NotificationPullRequest & {
  /** Event discriminator selecting the message template. */
  type: typeof NOTIFICATION_EVENT.PR_MERGED;
  /** Pull request title when available. */
  prTitle?: string;
  /** Merged pull request source branch. */
  sourceBranch?: string;
  /** Actual merge target branch. */
  targetBranch?: string;
  /** Actor or pipeline path that merged the pull request. */
  mergedBy: ValueOf<typeof NOTIFICATION_MERGE_ACTOR>;
};

/** Review feedback notification after a committed workflow transition. */
type ReviewFeedbackEvent = NotificationTitledIssue & NotificationPullRequest & {
  /** Event discriminator selecting the feedback message. */
  type: typeof NOTIFICATION_EVENT.CHANGES_REQUESTED | typeof NOTIFICATION_EVENT.MERGE_CONFLICT;
  /** Actual workflow label committed for this issue. */
  nextState: string;
};

/** Closed pull request notification after a committed workflow transition. */
type PullRequestClosedEvent = NotificationTitledIssue & NotificationPullRequest & {
  /** Event discriminator selecting the closed PR message. */
  type: typeof NOTIFICATION_EVENT.PR_CLOSED;
  /** Actual workflow label committed for this issue. */
  nextState: string;
};

/** Lifecycle event variants supported by notification rendering. */
export type NotifyEvent = PipelineCompleteEvent | WorkerStartEvent | WorkerCompleteEvent |
  ReviewNeededEvent | PullRequestMergedEvent | ReviewFeedbackEvent | PullRequestClosedEvent;

/** Routing and transport dependencies for one notification attempt. */
export type NotifyOptions = {
  /** Workspace where notification attempts are audited. */
  workspaceDir: string;
  /** Optional per-event delivery toggles. */
  config?: NotificationConfig;
  /** Target for project-scoped notifications (channelId). */
  channelId?: string;
  /** Channel type for routing. */
  channel?: NotificationChannel;
  /** Optional thread/topic ID for forum-style channels. */
  threadId?: string;
  /** Plugin runtime for direct API access. */
  runtime?: NotificationRuntime;
  /** Optional account ID for multi-account setups. */
  accountId?: string;
  /** Project-owning agent used to verify the exact OpenClaw binding. */
  agentId?: string;
  /** Injected command capability used for fallback delivery. */
  runCommand?: RunCommand;
};

/** Exact validated destination used by delivery and audit records. */
export type NotificationTarget = {
  /** Provider channel selected for delivery. */
  channel: NotificationChannel;
  /** Agent that owns the binding. */
  agentId: string;
  /** Account bound to the destination. */
  accountId: string;
  /** Provider destination identifier. */
  channelId: string;
  /** Optional topic or thread identifier. */
  threadId?: string;
};
