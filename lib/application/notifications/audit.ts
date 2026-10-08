/** Maps typed notification outcomes to the existing audit event contract. */

import { log as auditLog } from "../../audit.js";
import { MESSAGE_DELIVERY_STATUS } from "../../integrations/index.js";
import type { RouteDiagnostic } from "../setup/index.js";
import { NOTIFICATION_AUDIT,NOTIFICATION_AUDIT_OUTCOME } from "./const.js";
import type { NotificationDeliveryResult, NotificationTarget, NotifyEvent } from "./types.js";

/** No target was provided, so delivery was skipped. */
type NotificationAuditSkip = {
  /** Discriminator selecting skip audit mapping. */
  kind: typeof NOTIFICATION_AUDIT_OUTCOME.SKIP;
  /** Human-readable reason for skipping. */
  reason: string;
};

/** Required route information is absent or invalid. */
type NotificationAuditConfigurationError = {
  /** Discriminator selecting configuration error audit mapping. */
  kind: typeof NOTIFICATION_AUDIT_OUTCOME.CONFIGURATION_ERROR;
  /** Human-readable route failure reason. */
  reason: string;
  /** Candidate destination, when enough fields were provided. */
  target?: NotificationTarget;
  /** Exact route validation findings when a candidate exists. */
  diagnostics?: RouteDiagnostic[];
};

/** A validated delivery attempt is starting. */
type NotificationAuditAttempt = {
  /** Discriminator selecting attempt audit mapping. */
  kind: typeof NOTIFICATION_AUDIT_OUTCOME.ATTEMPT;
  /** Correlation identity shared with the final outcome. */
  eventId: string;
  /** Validated destination being attempted. */
  target: NotificationTarget;
  /** Transport paths available for this attempt. */
  paths: string[];
};

/** A transport accepted the message. */
type NotificationAuditSent = {
  /** Discriminator selecting sent audit mapping. */
  kind: typeof NOTIFICATION_AUDIT_OUTCOME.SENT;
  /** Correlation identity shared with the attempt. */
  eventId: string;
  /** Validated destination that accepted delivery. */
  target: NotificationTarget;
  /** Successful transport receipt. */
  receipt: NotificationDeliveryResult;
};

/** All available delivery paths failed. */
type NotificationAuditFailed = {
  /** Discriminator selecting failed audit mapping. */
  kind: typeof NOTIFICATION_AUDIT_OUTCOME.FAILED;
  /** Correlation identity shared with the attempt. */
  eventId: string;
  /** Validated destination that was attempted. */
  target: NotificationTarget;
  /** Transport paths that were available. */
  paths: string[];
  /** Final diagnostic message for operator inspection. */
  error: string;
  /** Evidence distinguishing rejection from uncertain delivery. */
  status: typeof MESSAGE_DELIVERY_STATUS.REJECTED | typeof MESSAGE_DELIVERY_STATUS.UNKNOWN;
};

/** Auditable decision made while routing or delivering one event. */
type NotificationAuditOutcome =
  | NotificationAuditSkip
  | NotificationAuditConfigurationError
  | NotificationAuditAttempt
  | NotificationAuditSent
  | NotificationAuditFailed;

/**
 * Record a notification decision with one consistent event identity and target shape.
 * @param workspaceDir - Workspace receiving the audit record.
 * @param event - Lifecycle event whose delivery was decided.
 * @param outcome - Typed decision or delivery outcome to record.
 */
export async function auditNotificationOutcome(workspaceDir: string, event: NotifyEvent, outcome: NotificationAuditOutcome): Promise<void> {
  if (outcome.kind === NOTIFICATION_AUDIT_OUTCOME.SKIP) {
    await auditLog(workspaceDir, NOTIFICATION_AUDIT.SKIP, { eventType: event.type, reason: outcome.reason });

    return;
  }

  const identity = { eventType: event.type, project: event.project, issueId: event.issueId };

  if (outcome.kind === NOTIFICATION_AUDIT_OUTCOME.CONFIGURATION_ERROR) {
    await auditLog(workspaceDir, NOTIFICATION_AUDIT.CONFIGURATION_ERROR, {
      ...identity,
      ...(outcome.target ? { agentId: outcome.target.agentId, target: outcome.target } : {}),
      ...(outcome.diagnostics ? { diagnostics: outcome.diagnostics } : { reason: outcome.reason }),
    });
  } else if (outcome.kind === NOTIFICATION_AUDIT_OUTCOME.ATTEMPT) {
    await auditLog(workspaceDir, NOTIFICATION_AUDIT.ATTEMPT, { eventId: outcome.eventId, ...identity, target: outcome.target, paths: outcome.paths });
  } else if (outcome.kind === NOTIFICATION_AUDIT_OUTCOME.SENT) {
    await auditLog(workspaceDir, NOTIFICATION_AUDIT.SENT, { eventId: outcome.eventId, ...identity, target: outcome.target, ...outcome.receipt });
  } else {
    await auditLog(workspaceDir, outcome.status === MESSAGE_DELIVERY_STATUS.UNKNOWN ? NOTIFICATION_AUDIT.UNKNOWN : NOTIFICATION_AUDIT.FAILED, {
      eventId: outcome.eventId, ...identity, target: outcome.target,
      attempts: outcome.paths, error: outcome.error, status: outcome.status,
    });
  }
}
