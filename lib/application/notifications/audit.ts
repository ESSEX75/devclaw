/** Maps typed notification outcomes to the existing audit event contract. */
import { log as auditLog } from "../../audit.js";
import type { RouteDiagnostic } from "../setup/route-validation.js";
import type { NotificationDeliveryResult, NotificationTarget, NotifyEvent } from "./types.js";

/** Auditable decision made while routing or delivering one event. */
type NotificationAuditOutcome =
  | {
    /** No target was provided, so delivery was skipped. */
    kind: "skip";
    /** Human-readable reason for skipping. */
    reason: string;
  }
  | {
    /** Required route information is absent or invalid. */
    kind: "configuration_error";
    /** Human-readable route failure reason. */
    reason: string;
    /** Candidate destination, when enough fields were provided. */
    target?: NotificationTarget;
    /** Exact route validation findings when a candidate exists. */
    diagnostics?: RouteDiagnostic[];
  }
  | {
    /** A validated delivery attempt is starting. */
    kind: "attempt";
    /** Correlation identity shared with the final outcome. */
    eventId: string;
    /** Validated destination being attempted. */
    target: NotificationTarget;
    /** Transport paths available for this attempt. */
    paths: string[];
  }
  | {
    /** A transport accepted the message. */
    kind: "sent";
    /** Correlation identity shared with the attempt. */
    eventId: string;
    /** Validated destination that accepted delivery. */
    target: NotificationTarget;
    /** Successful transport receipt. */
    receipt: NotificationDeliveryResult;
  }
  | {
    /** All available delivery paths failed. */
    kind: "failed";
    /** Correlation identity shared with the attempt. */
    eventId: string;
    /** Validated destination that was attempted. */
    target: NotificationTarget;
    /** Transport paths that were available. */
    paths: string[];
    /** Final diagnostic message for operator inspection. */
    error: string;
  };

/**
 * Record a notification decision with one consistent event identity and target shape.
 * @param workspaceDir - Workspace receiving the audit record.
 * @param event - Lifecycle event whose delivery was decided.
 * @param outcome - Typed decision or delivery outcome to record.
 */
export async function auditNotificationOutcome(workspaceDir: string, event: NotifyEvent, outcome: NotificationAuditOutcome): Promise<void> {
  if (outcome.kind === "skip") {
    await auditLog(workspaceDir, "notify_skip", { eventType: event.type, reason: outcome.reason });

    return;
  }

  const identity = { eventType: event.type, project: event.project, issueId: event.issueId };

  if (outcome.kind === "configuration_error") {
    await auditLog(workspaceDir, "notify_configuration_error", {
      ...identity,
      ...(outcome.target ? { agentId: outcome.target.agentId, target: outcome.target } : {}),
      ...(outcome.diagnostics ? { diagnostics: outcome.diagnostics } : { reason: outcome.reason }),
    });
  } else if (outcome.kind === "attempt") {
    await auditLog(workspaceDir, "notify_attempt", { eventId: outcome.eventId, ...identity, target: outcome.target, paths: outcome.paths });
  } else if (outcome.kind === "sent") {
    await auditLog(workspaceDir, "notify_sent", { eventId: outcome.eventId, ...identity, target: outcome.target, ...outcome.receipt });
  } else {
    await auditLog(workspaceDir, "notify_failed", {
      eventId: outcome.eventId, ...identity, target: outcome.target,
      attempts: outcome.paths, error: outcome.error,
    });
  }
}
