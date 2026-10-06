/**
 * Coordinates managed issue repair while keeping planning separate from effects.
 */

import { randomUUID } from "node:crypto";

import { ISSUE_INTEGRITY_STATUS } from "../../../domain/index.js";
import { withIssueOrchestrationLock } from "../../../state/index.js";
import { hasProjectWorkerSlot } from "../worker-slot.js";
import { applyLocalSourceRepair, applyProviderSourceRepair, readRateLimit, setRepairIntegrity } from "./apply.js";
import { auditRepair } from "./audit.js";
import { REPAIR_EVENT, REPAIR_MODE, REPAIR_STATUS, REPAIR_WARNING } from "./const.js";
import { ISSUE_REPAIR_ERROR, ISSUE_REPAIR_SOURCE } from "./const.js";
import { resolveRepairContext } from "./context.js";
import { blocked, mapRepairFailure } from "./failure.js";
import { buildRepairPlan } from "./plan.js";
import type { IssueRepairResult, RepairManagedIssueInput } from "./types.js";

/**
 * Build or apply one repair plan without transitioning workflow state or starting a worker.
 * Apply requires the token returned by a preceding dry-run and revalidates both snapshots under the issue lock.

 * @param input - Validated command input and runtime dependencies.
 */
export async function repairManagedIssue(input: RepairManagedIssueInput): Promise<IssueRepairResult> {
  const context = await resolveRepairContext(input);

  if (!input.apply) {
    const plan = buildRepairPlan(input, context);
    const correlationId = randomUUID();
    const rateLimitStatus = await readRateLimit(context.provider);

    if (!rateLimitStatus && context.provider.getRateLimitStatus) {
      plan.warnings.push({ code: REPAIR_WARNING.PRECHECK_UNAVAILABLE, message: "Provider quota precheck failed without blocking dry-run." });
    }

    await auditRepair(input, REPAIR_EVENT.DRY_RUN, correlationId, plan);

    return { ...plan, rateLimitStatus, auditCorrelationId: correlationId };
  }

  return withIssueOrchestrationLock(input.workspaceDir, input.projectSlug, input.issueId, async () => {
    const refreshed = await resolveRepairContext(input);
    const plan = buildRepairPlan(input, refreshed);

    if (!input.planToken || input.planToken !== plan.planToken) {
      return blocked(plan, ISSUE_REPAIR_ERROR.PLAN_STALE, "Repair plan is missing or no longer matches current snapshots.", false);
    }

    if (refreshed.local.activeWorker || refreshed.local.pendingWorkerRelease || hasProjectWorkerSlot(refreshed.project, input.issueId)) {
      return blocked(plan, ISSUE_REPAIR_ERROR.ACTIVE_WORKER, "An active worker owns this issue.", true);
    }

    const quota = await readRateLimit(refreshed.provider);

    if (!quota && refreshed.provider.getRateLimitStatus) {
      plan.warnings.push({ code: REPAIR_WARNING.PRECHECK_UNAVAILABLE, message: "Provider quota precheck failed; apply continues with bounded requests." });
    }

    if (quota && quota.remaining < plan.estimatedProviderRequests) {
      const result = blocked(plan, ISSUE_REPAIR_ERROR.RATE_LIMIT_PRECHECK_FAILED, "Provider quota is below the planned request budget.", true);

      if (result.error && quota.resetAt) result.error.retryAfter = quota.resetAt;

      return result;
    }

    if (!plan.changed) {
      const correlationId = randomUUID();

      await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.OK, []);
      await auditRepair(input, REPAIR_EVENT.VERIFIED, correlationId, plan);
      await auditRepair(input, REPAIR_EVENT.COMPLETED, correlationId, plan);

      return {
        ...plan,
        mode: REPAIR_MODE.APPLY,
        status: REPAIR_STATUS.ALREADY_CONSISTENT,
        integrityAfter: ISSUE_INTEGRITY_STATUS.OK,
        auditCorrelationId: correlationId,
      };
    }

    const correlationId = randomUUID();

    await auditRepair(input, REPAIR_EVENT.REQUESTED, correlationId, plan);
    await auditRepair(input, REPAIR_EVENT.APPLY_STARTED, correlationId, plan);

    try {
      const appliedActions = input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE
        ? await applyLocalSourceRepair(input, refreshed, plan)
        : await applyProviderSourceRepair(input, refreshed, plan);

      if (input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE) {
        await auditRepair(input, REPAIR_EVENT.PROVIDER_UPDATED, correlationId, plan);
      }

      const verified = await resolveRepairContext(input);
      const after = buildRepairPlan(input, verified);

      if (after.changed) {
        await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, ["repair verification did not produce a consistent projection"]);
        await auditRepair(input, REPAIR_EVENT.PARTIAL_FAILURE, correlationId, after);

        return {
          ...after,
          success: false,
          mode: REPAIR_MODE.APPLY,
          status: REPAIR_STATUS.PARTIAL_FAILURE,
          appliedActions,
          auditCorrelationId: correlationId,
          error: {
            code: ISSUE_REPAIR_ERROR.REPAIR_VERIFICATION_FAILED,
            message: "Provider verification did not confirm a consistent managed projection.",
            retryable: true,
          },
          recoveryPlan: [
            "Keep local integrity blocked.",
            "Inspect the returned post-apply diff.",
            "Run a new dry-run after provider availability is restored.",
          ],
        };
      }

      await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.OK, []);
      await auditRepair(input, REPAIR_EVENT.VERIFIED, correlationId, after);
      await auditRepair(input, REPAIR_EVENT.COMPLETED, correlationId, after);

      return {
        ...after,
        success: true,
        mode: REPAIR_MODE.APPLY,
        status: REPAIR_STATUS.REPAIRED,
        integrityAfter: ISSUE_INTEGRITY_STATUS.OK,
        changed: true,
        appliedActions,
        auditCorrelationId: correlationId,
        diffBefore: plan.diffBefore,
        diffAfter: after.diffBefore,
      };
    } catch (error) {
      const mapped = mapRepairFailure(plan, error);

      await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, [mapped.error?.message ?? "repair apply failed"]);
      await auditRepair(input, REPAIR_EVENT.FAILED, correlationId, mapped);

      return { ...mapped, mode: REPAIR_MODE.APPLY, status: REPAIR_STATUS.PARTIAL_FAILURE, auditCorrelationId: correlationId };
    }
  });
}
