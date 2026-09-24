/**
 * Coordinates managed issue repair while keeping planning separate from effects.
 */
import { randomUUID } from "node:crypto";

import { ISSUE_INTEGRITY_STATUS } from "../../../domain/index.js";
import { withIssueOrchestrationLock } from "../../../state/index.js";
import { applyLocalSourceRepair, applyProviderSourceRepair, readRateLimit, setRepairIntegrity } from "./apply.js";
import { auditRepair } from "./audit.js";
import { ISSUE_REPAIR_ERROR, ISSUE_REPAIR_SOURCE } from "./const.js";
import { resolveRepairContext } from "./context.js";
import { blocked, mapRepairFailure } from "./failure.js";
import { buildRepairPlan } from "./plan.js";
import type { IssueRepairResult, RepairManagedIssueInput } from "./types.js";

/**
 * Build or apply one repair plan without transitioning workflow state or starting a worker.
 * Apply requires the token returned by a preceding dry-run and revalidates both snapshots under the issue lock.
 */
export async function repairManagedIssue(input: RepairManagedIssueInput): Promise<IssueRepairResult> {
  const context = await resolveRepairContext(input);

  if (!input.apply) {
    const plan = buildRepairPlan(input, context);
    const correlationId = randomUUID();
    const rateLimitStatus = await readRateLimit(context.provider);

    if (!rateLimitStatus && context.provider.getRateLimitStatus) {
      plan.warnings.push({ code: "RATE_LIMIT_PRECHECK_UNAVAILABLE", message: "Provider quota precheck failed without blocking dry-run." });
    }

    await auditRepair(input, "issue_repair_dry_run", correlationId, plan);

    return { ...plan, rateLimitStatus, auditCorrelationId: correlationId };
  }

  return withIssueOrchestrationLock(input.workspaceDir, input.projectSlug, input.issueId, async () => {
    const refreshed = await resolveRepairContext(input);
    const plan = buildRepairPlan(input, refreshed);

    if (!input.planToken || input.planToken !== plan.planToken) {
      return blocked(plan, ISSUE_REPAIR_ERROR.PLAN_STALE, "Repair plan is missing or no longer matches current snapshots.", false);
    }

    if (refreshed.local.activeWorker) {
      return blocked(plan, ISSUE_REPAIR_ERROR.ACTIVE_WORKER, "An active worker owns this issue.", true);
    }

    const quota = await readRateLimit(refreshed.provider);

    if (!quota && refreshed.provider.getRateLimitStatus) {
      plan.warnings.push({ code: "RATE_LIMIT_PRECHECK_UNAVAILABLE", message: "Provider quota precheck failed; apply continues with bounded requests." });
    }

    if (quota && quota.remaining < plan.estimatedProviderRequests) {
      const result = blocked(plan, ISSUE_REPAIR_ERROR.RATE_LIMIT_PRECHECK_FAILED, "Provider quota is below the planned request budget.", true);

      if (result.error && quota.resetAt) result.error.retryAfter = quota.resetAt;

      return result;
    }

    if (!plan.changed) {
      const correlationId = randomUUID();

      await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.OK, []);
      await auditRepair(input, "issue_repair_verified", correlationId, plan);
      await auditRepair(input, "issue_repair_completed", correlationId, plan);

      return {
        ...plan,
        mode: "apply",
        status: "already_consistent",
        integrityAfter: ISSUE_INTEGRITY_STATUS.OK,
        auditCorrelationId: correlationId,
      };
    }

    const correlationId = randomUUID();

    await auditRepair(input, "issue_repair_requested", correlationId, plan);
    await auditRepair(input, "issue_repair_apply_started", correlationId, plan);

    try {
      const appliedActions = input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE
        ? await applyLocalSourceRepair(input, refreshed, plan)
        : await applyProviderSourceRepair(input, refreshed, plan);

      if (input.source === ISSUE_REPAIR_SOURCE.LOCAL_STATE) {
        await auditRepair(input, "issue_repair_provider_updated", correlationId, plan);
      }

      const verified = await resolveRepairContext(input);
      const after = buildRepairPlan(input, verified);

      if (after.changed) {
        await setRepairIntegrity(input, ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR, ["repair verification did not produce a consistent projection"]);
        await auditRepair(input, "issue_repair_partial_failure", correlationId, after);

        return {
          ...after,
          mode: "apply",
          status: "partial_failure",
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
      await auditRepair(input, "issue_repair_verified", correlationId, after);
      await auditRepair(input, "issue_repair_completed", correlationId, after);

      return {
        ...after,
        success: true,
        mode: "apply",
        status: "repaired",
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
      await auditRepair(input, "issue_repair_failed", correlationId, mapped);

      return { ...mapped, mode: "apply", status: "partial_failure", auditCorrelationId: correlationId };
    }
  });
}
