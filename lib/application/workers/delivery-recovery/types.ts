/** Contracts owned by worker delivery-recovery. */

import type { RunCommand } from "../../../context.js";
import type { WorkflowConfig } from "../../../domain/index.js";
import { WORKER_DELIVERY_RESOLUTION } from "../../../domain/index.js";
import type { SessionLookup } from "../../../integrations/openclaw/sessions/index.js";
import type { IssueProvider } from "../../../integrations/providers/index.js";
import type { ValueOf } from "../../../types.js";

/** Identity needed to inspect an unresolved gateway send without rollback. */
export type UnknownDispatchInput = {
  /** Submission token supplied by callbacks; heartbeat pins the observed marker when absent. */
  deliveryId?: string;
  /** Workspace containing project and issue state. */
  workspaceDir: string;
  /** Canonical project owning the slot. */
  projectSlug: string;
  /** Configured worker role. */
  role: string;
  /** Configured worker level. */
  level: string;
  /** Concrete reserved slot index. */
  slotIndex: number;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Deterministic worker session identity. */
  sessionKey: string;
  /** Gateway command capability for session inspection. */
  runCommand: RunCommand;
  /** Transport diagnostic prompting reconciliation. */
  reason: string;
  /** Gateway session snapshot already fetched by heartbeat, if available. */
  sessions?: SessionLookup | null;
  /** Whether the gateway command has settled without a confirmed acceptance. */
  outcomeUnknown?: boolean;
};

/** Explicit, audited operator decision for a still-reserved uncertain worker turn. */
export type ResolveWorkerDeliveryInput = {
  /** Exact operation identifier from the unresolved delivery marker. */
  deliveryId: string;
  /** Workspace containing authoritative project and issue state. */
  workspaceDir: string;
  /** Canonical project owning the worker slot. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Exact session identity shown by the unresolved status. */
  sessionKey: string;
  /** Operator's verified conclusion about this worker turn. */
  decision: ValueOf<typeof WORKER_DELIVERY_RESOLUTION>;
  /** Operator's evidence or investigation note for audit. */
  reason: string;
  /** Whether to apply the decision; false previews fresh state. */
  apply: boolean;
  /** Resolved workflow used to validate a safe queue return. */
  workflow?: WorkflowConfig;
  /** Optional provider supplied by tests or an existing application caller. */
  provider?: IssueProvider;
  /** Runtime command capability used when a provider must be created. */
  runCommand?: RunCommand;
};

/** Result of previewing or applying an explicit worker delivery decision. */
export type ResolveWorkerDeliveryResult = {
  /** Concrete submission whose durable resolution was resumed. */
  deliveryId: string;
  /** Whether the decision was applied. */
  applied: boolean;
  /** Project and issue bound to the verified session. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Exact session identity affected by the decision. */
  sessionKey: string;
  /** Operator conclusion recorded for this worker turn. */
  decision: ValueOf<typeof WORKER_DELIVERY_RESOLUTION>;
  /** Previous active workflow label. */
  fromLabel: string;
  /** Queue label after confirmed non-start, or active label after confirmed start. */
  toLabel: string;
};
