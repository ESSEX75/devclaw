/** Read-only doctor diagnostic contracts. */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

/** One doctor finding with a stable code and severity. */
export type DoctorFinding = {
  /** Stable identifier for automation and support references. */
  code: string;
  /** Whether this finding blocks safe DevClaw routing. */
  severity: "error" | "info";
  /** Human-readable diagnostic message. */
  message: string;
};

/** Routing and tool-access matrix returned by the doctor application service. */
export type RoutingDoctorReport = {
  /** True when no blocking routing or isolation finding exists. */
  ok: boolean;
  /** Route and policy findings. */
  findings: DoctorFinding[];
  /** Explicit DevClaw tool access calculated for every configured agent. */
  agents: Array<{ agentId: string; devclawToolsAllowed: boolean }>;
  /** Active/archive counters for every configured project. */
  archives: Array<{
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
  }>;
};


/** Read-only SDK surface used by diagnostics. */
export type DoctorRuntime = {
  /** Configuration read capability; no mutation transport is required. */
  config: Pick<PluginRuntime["config"], "current">;
};
