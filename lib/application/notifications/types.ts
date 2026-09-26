/** Defines notification events, delivery receipts, runtime capability, and route options. */
import type { RunCommand } from "../../context.js";
import type { NotificationChannel } from "../../domain/index.js";
import type { RouteConfig } from "../setup/types.js";

/** Per-event-type toggle. All default to true — set to false to suppress. */
export type NotificationConfig = Partial<Record<NotifyEvent["type"], boolean>>;

/** Receipt returned only after a transport reports successful delivery. */
export type NotificationDeliveryResult = {
  /** Confirms that the selected transport accepted the message. */
  delivered: true;
  /** Provider message identifier when direct runtime delivery exposes it. */
  messageId?: string;
  /** Provider channel used for delivery. */
  channel: NotificationChannel;
  /** Account bound to the validated destination. */
  accountId: string;
  /** Provider destination identifier. */
  channelId: string;
  /** Optional forum topic or thread. */
  threadId?: string;
  /** Transport that accepted the message. */
  path: "runtime" | "fallback";
};

/** Narrow runtime surface required by notification delivery. */
export type NotificationRuntime = {
  /** Current route configuration used to validate the exact binding. */
  config: {
    /** Read the runtime's current route configuration. */
    current(): RouteConfig;
  };
  /** Runtime channel adapter access. */
  channel: {
    /** Outbound adapter loader for the selected channel. */
    outbound: {
      /** Load an adapter whose send capability is validated at runtime. */
      loadAdapter(channel: string): Promise<unknown>;
    };
  };
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

/** Lifecycle event variants supported by notification rendering. */
export type NotifyEvent =
  | {
      /** Event discriminator selecting the message template. */
      type: "pipelineComplete";
      /** Project name shown in the notification. */
      project: string;
      /** Provider-local issue identifier shown to recipients. */
      issueId: number;
      /** Current issue title shown to recipients. */
      issueTitle: string;
      /** Link to the provider issue. */
      issueUrl: string;
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
    }
  | {
      /** Event discriminator selecting the message template. */
      type: "workerStart";
      /** Project name shown in the notification. */
      project: string;
      /** Provider-local issue identifier shown to recipients. */
      issueId: number;
      /** Current issue title shown to recipients. */
      issueTitle: string;
      /** Link to the provider issue. */
      issueUrl: string;
      /** Configured worker role used in the message. */
      role: string;
      /** Resolved worker level when known. */
      level: string;
      /** Worker display name when available. */
      name?: string;
      /** Whether the worker session was created or resumed. */
      sessionAction: "spawn" | "send";
    }
  | {
      /** Event discriminator selecting the message template. */
      type: "workerComplete";
      /** Project name shown in the notification. */
      project: string;
      /** Provider-local issue identifier shown to recipients. */
      issueId: number;
      /** Link to the provider issue. */
      issueUrl: string;
      /** Configured worker role used in the message. */
      role: string;
      /** Resolved worker level when known. */
      level?: string;
      /** Worker display name when available. */
      name?: string;
      /** Worker completion outcome. */
      result: string;
      /** Worker supplied completion summary. */
      summary?: string;
      /** Workflow label selected after completion. */
      nextState?: string;
      /** Related pull request link. */
      prUrl?: string;
      /** Tasks created by the completing worker. */
      createdTasks?: NotificationCreatedTask[];
    }
  | {
      /** Event discriminator selecting the message template. */
      type: "reviewNeeded";
      /** Project name shown in the notification. */
      project: string;
      /** Provider-local issue identifier shown to recipients. */
      issueId: number;
      /** Link to the provider issue. */
      issueUrl: string;
      /** Current issue title shown to recipients. */
      issueTitle: string;
      /** Review recipient selected by policy. */
      routing: "human" | "agent";
      /** Related pull request link. */
      prUrl?: string;
    }
  | {
      /** Event discriminator selecting the message template. */
      type: "prMerged";
      /** Project name shown in the notification. */
      project: string;
      /** Provider-local issue identifier shown to recipients. */
      issueId: number;
      /** Link to the provider issue. */
      issueUrl: string;
      /** Current issue title shown to recipients. */
      issueTitle: string;
      /** Related pull request link. */
      prUrl?: string;
      /** Pull request title when available. */
      prTitle?: string;
      /** Merged pull request source branch. */
      sourceBranch?: string;
      /** Actual merge target branch. */
      targetBranch?: string;
      /** Actor or pipeline path that merged the pull request. */
      mergedBy: "heartbeat" | "agent" | "pipeline";
    }
  | {
      /** Event discriminator selecting the message template. */
      type: "changesRequested";
      /** Project name shown in the notification. */
      project: string;
      /** Provider-local issue identifier shown to recipients. */
      issueId: number;
      /** Link to the provider issue. */
      issueUrl: string;
      /** Current issue title shown to recipients. */
      issueTitle: string;
      /** Related pull request link. */
      prUrl?: string;
    }
  | {
      /** Event discriminator selecting the message template. */
      type: "mergeConflict";
      /** Project name shown in the notification. */
      project: string;
      /** Provider-local issue identifier shown to recipients. */
      issueId: number;
      /** Link to the provider issue. */
      issueUrl: string;
      /** Current issue title shown to recipients. */
      issueTitle: string;
      /** Related pull request link. */
      prUrl?: string;
    }
  | {
      /** Event discriminator selecting the message template. */
      type: "prClosed";
      /** Project name shown in the notification. */
      project: string;
      /** Provider-local issue identifier shown to recipients. */
      issueId: number;
      /** Link to the provider issue. */
      issueUrl: string;
      /** Current issue title shown to recipients. */
      issueTitle: string;
      /** Related pull request link. */
      prUrl?: string;
    };


/** Routing and transport dependencies for one notification attempt. */
export type NotifyOptions = {
    /** Workspace where notification attempts are audited. */
    workspaceDir: string;
    /** Optional per-event delivery toggles. */
    config?: NotificationConfig;
    /** Target for project-scoped notifications (channelId) */
    channelId?: string;
    /** Channel type for routing (e.g. "telegram", "whatsapp", "discord", "slack") */
    channel?: NotificationChannel;
    /** Optional thread/topic ID for forum-style channels */
    threadId?: string;
    /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
    runtime?: NotificationRuntime;
    /** Optional account ID for multi-account setups */
    accountId?: string;
    /** Project-owning agent used to verify the exact OpenClaw binding. */
    agentId?: string;
    /** Injected runCommand for dependency injection. */
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
