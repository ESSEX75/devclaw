/** Reports and execution contracts shared by heartbeat coordinators. */
import type { RunCommand } from "../../context.js";
import type { Project } from "../../domain/index.js";
import type { ResolvedConfig } from "../../state/index.js";
import type { SessionLookup } from "./health/gateway-sessions.js";
import type { HealthFix, HealthIssue, WorkerHealthInput } from "./health/types.js";

/** Explicit diagnosis or remediation request for all project health checks. */
export type HealthPassInput = {
  /** Workspace containing authoritative state. */
  workspaceDir: string;
  /** Stable project key. */
  projectSlug: string;
  /** Project snapshot used by diagnosis. */
  project: Project;
  /** Gateway observations for this tick. */
  sessions: SessionLookup | null;
  /** Provider used to inspect or repair the projection. */
  provider: WorkerHealthInput["provider"];
  /** Validated project configuration. */
  resolvedConfig: ResolvedConfig;
  /** Explicit permission to apply diagnosed actions. */
  autoFix: boolean;
  /** Worker age threshold. */
  staleWorkerHours?: number;
  /** Owner used to scope managed issues. */
  instanceName?: string;
  /** Required command capability for explicit session remediation. */
  runCommand: RunCommand;
  /** Session inactivity threshold. */
  stallTimeoutMinutes?: number;
  /** Agent receiving remediation nudges. */
  agentId?: string;
};

/** A pass operation or a concrete health remedy represented in a report. */
export type HeartbeatAction = {
  /** Operation or remediation identifier. */
  kind: string;
  /** Issue affected by a concrete remedy. */
  issueId?: number | null;
};

/** Observable outcome of one named project pass. */
export type HeartbeatPassReport = {
  /** Stable name of the pass. */
  name: string;
  /** Project whose data was inspected. */
  projectSlug: string;
  /** Diagnostics collected before remediation. */
  findings: HealthIssue[];
  /** Health actions selected by diagnosis. */
  plannedActions: HeartbeatAction[];
  /** Health actions whose remediation completed. */
  appliedActions: HeartbeatAction[];
  /** Failures retained even if a later project continues. */
  errors: string[];
};

/** One sequential pass with an explicit application operation. */
export type HeartbeatPass = {
  /** Name used in diagnostics and errors. */
  name: string;
  /** Application operation, optionally returning detailed health results. */
  run: () => Promise<HealthFix[] | void>;
};

/** Aggregated counters and retained pass reports for one heartbeat tick. */
export type HeartbeatTickResult = {
  /** Workers picked up by queue operations. */
  totalPickups: number;
  /** Applied health remedies. */
  totalHealthFixes: number;
  /** Skipped projects and queue candidates. */
  totalSkipped: number;
  /** Successful human review transitions. */
  totalReviewTransitions: number;
  /** Successful review skip transitions. */
  totalReviewSkipTransitions: number;
  /** Successful test skip transitions. */
  totalTestSkipTransitions: number;
  /** Issues archived by recovery. */
  totalArchived: number;
  /** Creations completed by recovery. */
  totalCreationsReady: number;
  /** Creations still awaiting recovery. */
  totalCreationsPending: number;
  /** Creations requiring intervention. */
  totalCreationsManual: number;
  /** Per-project pass outcomes, including failures. */
  passes: HeartbeatPassReport[];
};
