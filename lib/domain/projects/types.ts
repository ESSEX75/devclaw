/**
 * projects/types.ts — Domain types for projects, worker slots, and notification channels.
 */
import type { IssueProviderType, NotificationChannel } from "../shared/types.js";

/** Slot state. Level is structural (implied by position in the levels map). */
export type SlotState = {
  /** Whether the slot is currently active and assigned to an issue. */
  active: boolean;
  /** Unique identifier of the currently assigned issue. */
  issueId: string | null;
  /** Unique session key of the active worker run. */
  sessionKey: string | null;
  /** ISO timestamp when work started in this slot. */
  startTime: string | null;
  /** Previous workflow label before assignment. */
  previousLabel?: string | null;
  /** Deterministic fun name for this slot (e.g. "Ada", "Grace"). */
  name?: string;
  /** Last issue this slot worked on (preserved on deactivation for feedback cycle detection). */
  lastIssueId?: string | null;
};

/** Per-level worker state: levels map instead of flat slots array. */
export type RoleWorkerState = {
  /** Map of level IDs to arrays of slot states. */
  levels: Record<string, SlotState[]>;
};

/** Channel registration: maps a channelId to messaging endpoint with event filters. */
export type Channel = {
  /** Unique channel identifier. */
  channelId: string;
  /** Messaging platform type (e.g. telegram, slack). */
  channel: NotificationChannel;
  /** Channel display name (e.g. "primary", "dev-chat"). */
  name: string;
  /** List of event names to listen for (e.g. ["*"], ["workerComplete"]). */
  events: string[];
  /** Optional account ID for multi-account setups. */
  accountId?: string;
  /** Optional thread or topic ID for forum-style channels. */
  threadId?: string;
};

/** Project configuration schema. */
export type Project = {
  /** Unique project slug. */
  slug: string;
  /** Human-readable project name. */
  name: string;
  /** Repository name or local path. */
  repo: string;
  /** Git remote URL (e.g. https://github.com/.../repo.git). */
  repoRemote?: string;
  /** Group or organization name owning the project. */
  groupName: string;
  /** Deployment environment target URL. */
  deployUrl: string;
  /** Target base branch for development (e.g. main/master). */
  baseBranch: string;
  /** Target branch for deployment releases. */
  deployBranch: string;
  /** Channels registered for this project (notification endpoints). */
  channels: Channel[];
  /** Issue tracker provider type (github or gitlab). Auto-detected at registration, stored for reuse. */
  provider?: IssueProviderType;
  /** Worker state per role (developer, tester, architect, etc.). Shared across all channels. */
  workers: Record<string, RoleWorkerState>;
};

/** Data structure for the projects registry store. */
export type ProjectsData = {
  /** Map of project slugs to project configurations. */
  projects: Record<string, Project>;
};
