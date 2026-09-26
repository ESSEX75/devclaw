/** Read-only doctor diagnostic contracts. */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { ValueOf } from "../../types.js";
import type { DOCTOR_SEVERITY } from "./const.js";

/** Severity derived from the doctor-owned registry without widening its value set. */
export type DoctorSeverity = ValueOf<typeof DOCTOR_SEVERITY>;

/** One doctor finding with a stable code and severity. */
export type DoctorFinding = {
  /** Stable identifier for automation and support references. */
  code: string;
  /** Whether this finding blocks safe DevClaw routing. */
  severity: DoctorSeverity;
  /** Human-readable diagnostic message. */
  message: string;
};

/** Archive counters observed for one successfully inspected project. */
type DoctorProjectArchiveCounters = {
  /** Canonical project identifier. */
  projectSlug: string;
  /** Active managed issue count. */
  active: number;
  /** Terminal issues awaiting archival. */
  terminalWaitingArchive: number;
  /** Archived issue count. */
  archived: number;
  /** Archived records whose provider issue was deleted. */
  providerDeleted: number;
  /** Records eligible for retention cleanup. */
  purgeEligible: number;
  /** Retained attachment size in bytes. */
  attachmentsRetainedBytes: number;
};

/** Explicit DevClaw tool access observed for one configured agent. */
type DoctorAgentToolAccess = {
  /** Configured OpenClaw agent whose explicit policy was inspected. */
  agentId: string;
  /** Whether this project owner explicitly allows every required DevClaw tool. */
  devclawToolsAllowed: boolean;
};

/** Routing and tool-access matrix returned by the doctor application service. */
export type RoutingDoctorReport = {
  /** True when all requested routing, isolation, and archive checks have no blocking findings. */
  ok: boolean;
  /** Route, policy, and archive findings, including incomplete project inspections. */
  findings: DoctorFinding[];
  /** Explicit DevClaw tool access calculated for every configured agent. */
  agents: DoctorAgentToolAccess[];
  /** Counters for successfully inspected projects; failed projects have findings instead. */
  archives: DoctorProjectArchiveCounters[];
};

/** Loaded archive observations consumed by the pure report builder. */
export type DoctorArchiveReport = Pick<RoutingDoctorReport, "archives" | "findings">;

/** Read-only SDK surface used by diagnostics. */
export type DoctorRuntime = {
  /** Configuration read capability; no mutation transport is required. */
  config: Pick<PluginRuntime["config"], "current">;
};
