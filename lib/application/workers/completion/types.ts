/** Contracts owned by worker completion. */

import type { RunCommand } from "../../../context.js";
import type { ActiveIssueWorker, Project, RoleWorkerState, WorkflowConfig } from "../../../domain/index.js";
import type { ResolvedConfig } from "../../../state/index.js";
import type { NotificationCreatedTask, NotificationRuntime } from "../../notifications/index.js";
import type { CompletionOutput } from "../../pipeline/index.js";

/** Validated worker completion request from an adapter. */
export type FinishWorkInput = {
  /** Workspace containing the project registry. */
  workspaceDir: string;
  /** Unambiguous project destination supplied by the adapter. */
  channelId: string;
  /** Configured completing role. */
  role: string;
  /** Configured completion result. */
  result: string;
  /** Worker completion summary. */
  summary?: string;
  /** Optional observed PR URL. */
  prUrl?: string;
  /** Child tasks created by the worker. */
  createdTasks?: NotificationCreatedTask[];
  /** Exact caller session when available. */
  sessionKey?: string;
  /** External command capability. */
  runCommand: RunCommand;
  /** Notification runtime capability. */
  runtime?: NotificationRuntime;
  /** Notification settings. */
  pluginConfig?: Record<string, unknown>;
};

/** Resolved finish context; the pipeline rechecks captured worker identity under its issue lock. */
export type FinishWorkContext = {
  /** Project selected without ambiguous routing. */
  project: Project;
  /** Fully resolved roles and workflow. */
  config: ResolvedConfig;
  /** Selected provider-local issue. */
  issueId: number;
  /** Exact slot run captured before PR preconditions. */
  worker: ActiveIssueWorker;
};

/** Successful finish response returned to tool adapters. */
export type FinishWorkResult = CompletionOutput & {
  /** Completion command finished successfully. */
  success: true;
  /** Human-readable project name. */
  project: string;
  /** Canonical project identity. */
  projectSlug: string;
  /** Completed issue. */
  issueId: number;
  /** Configured completing role. */
  role: string;
  /** Configured result. */
  result: string;
};

/** Rejection context retained without masking the original missing-worker error. */
export type MissingWorkerAuditInput = {
  /** Workspace receiving the audit record. */
  workspaceDir: string;
  /** Project display name. */
  projectName: string;
  /** Canonical project identity. */
  projectSlug: string;
  /** Requested role. */
  role: string;
  /** Requested result. */
  result: string;
  /** Requested caller session. */
  sessionKey?: string;
  /** Observed worker inventory. */
  roleWorker: RoleWorkerState;
  /** Resolved workflow interpreting local candidates. */
  workflow: WorkflowConfig;
};
