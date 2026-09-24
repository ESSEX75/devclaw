/**
 * Defines the domain fields needed to build an initial managed issue record.
 */
import type { IssueRuntimeState } from "../../domain/index.js";

/** Validated lifecycle choices preserved in an initial runtime record. */
export type InitialIssueRuntimeInput = Pick<
  IssueRuntimeState,
  | "provider"
  | "workflowState"
  | "workflowLabel"
  | "assignedRole"
  | "assignedLevel"
  | "owner"
  | "reviewPolicy"
  | "testPolicy"
  | "notifyTarget"
>;
