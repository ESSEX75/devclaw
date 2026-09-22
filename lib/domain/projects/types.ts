/**
 * projects/types.ts — Domain types for projects, worker slots, and notification channels.
 */
import type { IssueProviderId } from "../issues/index.js";
import type { NotificationEndpoint } from "../notifications/index.js";

/** Slot state. Level is structural (implied by position in the levels map). */
export type SlotState = {
  /** Whether the slot is currently active and assigned to an issue. */
  active: boolean;
  /** Unique identifier of the currently assigned issue. */
  issueId: number | null;
  /** Unique session key of the active worker run. */
  sessionKey: string | null;
  /** ISO timestamp when work started in this slot. */
  startTime: string | null;
  /** Previous workflow label before assignment. */
  previousLabel?: string | null;
  /** Deterministic fun name for this slot (e.g. "Ada", "Grace"). */
  name?: string;
  /** Last issue this slot worked on (preserved on deactivation for feedback cycle detection). */
  lastIssueId?: number | null;
};

/** Per-level worker state: levels map instead of flat slots array. */
export type RoleWorkerState = {
  /** Map of level IDs to arrays of slot states. */
  levels: Partial<Record<string, SlotState[]>>;
};

/** Location of a worker slot within a role's level map. */
export type SlotLocation = {
  /** Level containing the slot. */
  level: string;
  /** Zero-based slot index within the level. */
  slotIndex: number;
};

/** Runtime project definition shared by domain and persistence consumers. */
export type Project = {
  /** Unique project slug. */
  slug: string;
  /** Human-readable project name. */
  name: string;
  /** OpenClaw agent that owns this project and its channel bindings. */
  agentId: string;
  /** Repository name or local path. */
  repo: string;
  /** Target base branch for development (e.g. main/master). */
  baseBranch: string;
  /** Target branch for deployment releases. */
  deployBranch: string;
  /** Channels registered for this project (notification endpoints). */
  channels: NotificationEndpoint[];
  /** Issue tracker provider type (github or gitlab). Auto-detected at registration, stored for reuse. */
  provider: IssueProviderId;
  /** Worker state per role (developer, tester, architect, etc.). Shared across all channels. */
  workers: Record<string, RoleWorkerState>;
};
