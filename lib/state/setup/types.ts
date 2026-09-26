/**
 * Defines the public contracts owned by the state setup capability.
 */
import type { RoleId } from "../../domain/index.js";

/** Complete packaged template set consumed by setup and runtime fallbacks. */
export type SetupTemplates = {
  /** Root agent instructions. */
  agents: string;
  /** Heartbeat instructions. */
  heartbeat: string;
  /** Initial identity document. */
  identity: string;
  /** Agent persona document. */
  soul: string;
  /** Tool instructions. */
  tools: string;
  /** Current workflow configuration example. */
  workflow: string;
  /** Role instructions indexed by built-in role identifier. */
  roleInstructions: Readonly<Record<RoleId, string>>;
};

/** Structured record of filesystem paths actually written by a setup capability. */
export type WorkspaceWriteResult = {
  /** Workspace-relative paths created or replaced. */
  written: string[];
};

/** Role instruction content together with its resolved source for diagnostics. */
export type RoleInstructionsResult = {
  /** Complete role instruction content, or an empty string when no source exists. */
  content: string;
  /** Filesystem path or package-default marker that supplied the content. */
  source: string | null;
};

/** Explicit subset of packaged defaults selected for replacement. */
export type DefaultsScope = "all" | "workflow" | "prompts";

/** Raw workflow documents available for a read-only application comparison. */
export type WorkflowDocuments = {
  /** Existing workspace document, absent when defaults are implicit. */
  current: string | null;
  /** Packaged reference document. */
  template: string;
};
