/** Lifecycle task contracts, shared by the owning capability. */

import type { RunCommand } from "../../../context.js";
import type { IssueProviderId, IssueRuntimeState, Project, WorkflowConfig, WorkflowStateConfig } from "../../../domain/index.js";
import { STATE_TYPE } from "../../../domain/index.js";
import type { IssueProvider } from "../../../integrations/index.js";
import type { ResolvedRoleConfig } from "../../../state/index.js";

/** Ownership-transfer outcome; a refusal preserves the current owner. */
export type ClaimManagedTaskResult = ClaimAccepted | ClaimRefused;

/** Ownership was transferred successfully. */
type ClaimAccepted = {
  /** Successful transfer discriminator. */
  claimed: true;
};

/** A fresh-state eligibility check refused the transfer. */
type ClaimRefused = {
  /** Refused transfer discriminator. */
  claimed: false;
  /** Operator guidance explaining the refusal. */
  reason: string;
};

/** Requested user-content edit, executed after fresh eligibility checks under the issue lock. */
export type EditTaskBodyInput = {
  /** Configured workspace containing authoritative project state. */
  workspaceDir: string;
  /** Persisted notification destination used to resolve exactly one project. */
  channelId: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Requested title, omitted to retain current provider content. */
  title?: string;
  /** Requested user description, excluding authoritative metadata. */
  body?: string;
  /** Operator explanation or reason the command could not proceed. */
  reason?: string;
  /** Whether to publish an explanatory provider comment; defaults to true. */
  addComment?: boolean;
  /** Runtime-owned command transport for provider operations. */
  runCommand: RunCommand;
};

/** Validated queue destination of a HOLD approval transition. */
export type QueueTarget = {
  /** Configured workflow key of the selected queue. */
  stateKey: string;
  /** Resolved queue configuration receiving the task. */
  state: Extract<WorkflowStateConfig, { type: typeof STATE_TYPE.QUEUE }>;
};

/** Pure transition plan and resolved worker assignment. */
export type StartTaskDecision = {
  /** Authoritative workflow key before the transition. */
  fromStateKey: string;
  /** Current provider-visible workflow label. */
  fromLabel: string;
  /** Configured workflow key selected by the approval transition. */
  targetStateKey: string;
  /** Provider-visible label for the target queue. */
  targetLabel: string;
  /** Configured worker role responsible for the target queue. */
  targetRole: string;
  /** Resolved worker level, preserving valid explicit assignments. */
  assignedLevel: string;
};

/** Explicit prepared-level change for a managed task. */
export type SetTaskLevelInput = {
  /** Configured workspace containing authoritative project state. */
  workspaceDir: string;
  /** Persisted notification destination used to resolve exactly one project. */
  channelId: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Requested or resolved level from the effective role configuration. */
  level: string;
  /** Operator explanation or reason the command could not proceed. */
  reason?: string;
  /** Runtime-owned command transport for provider operations. */
  runCommand: RunCommand;
};

/** Confirmed prepared assignment and operator-facing result. */
export type SetTaskLevelResult = {
  /** Confirms that the lifecycle command completed. */
  success: true;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Provider title used for task context and operator output. */
  issueTitle: string;
  /** Requested or resolved level from the effective role configuration. */
  level: string;
  /** Whether the command changed the current assignment or content. */
  changed: boolean;
  /** Resolved project or its display name in command output. */
  project: string;
  /** Provider capability or identifier used for this operation. */
  provider: string;
  /** Human-readable result for adapter delivery. */
  announcement: string;
};

/** Explicit approval request for a held managed task. */
export type StartTaskInput = {
  /** Configured workspace containing authoritative project state. */
  workspaceDir: string;
  /** Persisted notification destination used to resolve exactly one project. */
  channelId: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Requested or resolved level from the effective role configuration. */
  level?: string;
  /** Runtime-owned command transport for provider operations. */
  runCommand: RunCommand;
};

/** Confirmed lifecycle transition and resulting assignment. */
export type StartTaskResult = {
  /** Confirms that the lifecycle command completed. */
  success: true;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Provider title used for task context and operator output. */
  issueTitle: string;
  /** Workflow label before the transition. */
  from: string;
  /** Workflow label after the transition. */
  to: string;
  /** Whether a workflow transition was applied. */
  transitioned: boolean;
  /** Requested or resolved level from the effective role configuration. */
  level: string | null;
  /** Resolved project or its display name in command output. */
  project: string;
  /** Human-readable result for adapter delivery. */
  announcement: string;
};

/** Inputs consumed by claimManagedTask after adapter validation. */
export type ClaimManagedTaskInput = {
  /** Configured workspace containing authoritative project state. */
  workspaceDir: string;
  /** Resolved project or its display name in command output. */
  project: Project;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Instance identity to persist as the issue owner. */
  instanceName: string;
  /** Allows explicit transfer from another owner. */
  force: boolean;
  /** Provider capability or identifier used for this operation. */
  provider: IssueProvider;
  /** Canonical provider identifier persisted in runtime state. */
  providerType: IssueProviderId;
  /** Effective project workflow including custom states. */
  workflow: WorkflowConfig;
  /** Effective role identifiers or resolved role configurations. */
  roles: string[];
};

/** Inputs consumed by resolveRoleLevel after adapter validation. */
export type ResolveRoleLevelInput = {
  /** Optional explicit level overriding automatic selection. */
  requestedLevel?: string;
  /** Authoritative local issue record used to make the decision. */
  runtimeState: IssueRuntimeState;
  /** Configured worker role responsible for the target queue. */
  targetRole: string;
  /** Effective role settings including enabled levels. */
  roleConfig: ResolvedRoleConfig;
  /** Provider title used for task context and operator output. */
  issueTitle: string;
  /** Provider description used for worker context or level selection. */
  issueDescription: string;
};

/** Inputs consumed by resolveStartTaskDecision after adapter validation. */
export type ResolveStartTaskDecisionInput = {
  /** Effective project workflow including custom states. */
  workflow: WorkflowConfig;
  /** Resolved configuration of the current authoritative state. */
  currentState: WorkflowStateConfig;
  /** Authoritative local issue record used to make the decision. */
  runtimeState: IssueRuntimeState;
  /** Effective role identifiers or resolved role configurations. */
  roles: Readonly<Record<string, ResolvedRoleConfig>>;
  /** Optional explicit level overriding automatic selection. */
  requestedLevel?: string;
  /** Provider title used for task context and operator output. */
  issueTitle: string;
  /** Provider description used for worker context or level selection. */
  issueDescription: string;
};
