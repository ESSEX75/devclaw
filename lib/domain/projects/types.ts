import { SoftUnion } from "../../types.js";
import type { IssueProvider } from "../issues/types.js";
import { NOTIFICATION_CHANNEL } from "./const.js";

/** Supported notification channel/messaging platform types. */
export type NotificationChannel = SoftUnion<typeof NOTIFICATION_CHANNEL>;

// ---------------------------------------------------------------------------
// Per-level worker model — each level gets its own slot array
// ---------------------------------------------------------------------------

/** Slot state. Level is structural (implied by position in the levels map). */
export type SlotState = {
  active: boolean;
  issueId: string | null;
  sessionKey: string | null;
  startTime: string | null;
  previousLabel?: string | null;
  /** Deterministic fun name for this slot (e.g. "Ada", "Grace"). */
  name?: string;
  /** Last issue this slot worked on (preserved on deactivation for feedback cycle detection). */
  lastIssueId?: string | null;
};

/** Per-level worker state: levels map instead of flat slots array. */
export type RoleWorkerState = {
  levels: Record<string, SlotState[]>;
};

/**
 * Channel registration: maps a channelId to messaging endpoint with event filters.
 */
export type Channel = {
  channelId: string;
  channel: NotificationChannel;
  name: string; // e.g. "primary", "dev-chat"
  events: string[]; // e.g. ["*"] for all, ["workerComplete"] for filtered
  accountId?: string; // Optional account ID for multi-account setups
  threadId?: string; // Optional thread/topic ID for forum-style channels
};

/**
 * Project configuration in the new project-first schema.
 */
export type Project = {
  slug: string;
  name: string;
  repo: string;
  repoRemote?: string; // Git remote URL (e.g., https://github.com/.../repo.git)
  groupName: string;
  deployUrl: string;
  baseBranch: string;
  deployBranch: string;
  /** Channels registered for this project (notification endpoints). */
  channels: Channel[];
  /** Issue tracker provider type (github or gitlab). Auto-detected at registration, stored for reuse. */
  provider?: IssueProvider;
  /** Worker state per role (developer, tester, architect, or custom roles). Shared across all channels. */
  workers: Record<string, RoleWorkerState>;
};

/**
 * Data structure for the projects registry store.
 */
export type ProjectsData = {
  projects: Record<string, Project>; // Keyed by slug
};
