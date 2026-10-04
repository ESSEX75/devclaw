/**
 * Resumes bounded unfinished creation operations during heartbeat passes.
 */

import { ISSUE_CREATION_STATUS } from "../../../domain/index.js";
import { readIssueCreationStore, withIssueCreationLock } from "../../../state/index.js";
import { creationAudit } from "./audit.js";
import { CREATION_EVENT, CREATION_RECONCILIATION_REQUESTER, CREATION_RESULT_STATUS } from "./const.js";
import { withCreationPermit } from "./permit.js";
import { runCreationOperation } from "./runner.js";
import type { ReconcileManagedTaskCreationsInput, ReconcileManagedTaskCreationsResult } from "./types.js";

/**
 * Reconcile bounded unfinished creation operations during heartbeat passes.
 * Each operation is re-read after acquiring its idempotency lock.
 *
 * @param opts - Project, provider, workflow, and maximum pass size.
 */
export async function reconcileManagedTaskCreations(opts: ReconcileManagedTaskCreationsInput): Promise<ReconcileManagedTaskCreationsResult> {
  const store = await readIssueCreationStore(opts.workspaceDir, opts.project.slug);
  const operations = Object.values(store.operations)
    .filter((operation) => operation.status !== ISSUE_CREATION_STATUS.READY)
    .slice(0, opts.maxItems);
  const ready: number[] = [];
  const pending: string[] = [];
  const manual: string[] = [];

  for (const operation of operations) {
    await withIssueCreationLock(opts.workspaceDir, opts.project.slug, operation.idempotencyKey, async () => {
      const current = (await readIssueCreationStore(opts.workspaceDir, opts.project.slug)).operations[operation.idempotencyKey];

      if (!current || current.status === ISSUE_CREATION_STATUS.READY) return;
      const operationOpts = {
        ...opts,
        title: current.input.title,
        description: current.input.body,
        assignees: current.input.assignees,
        notifyTarget: current.input.notifyTarget,
        owner: current.input.owner,
        idempotencyKey: current.idempotencyKey,
        requestedBy: CREATION_RECONCILIATION_REQUESTER,
        workflowState: current.input.workflowState,
        assignedRole: current.input.assignedRole,
        assignedLevel: current.input.assignedLevel,
      };

      await creationAudit(operationOpts, current, CREATION_EVENT.RECONCILIATION_SCHEDULED);
      const result = await withCreationPermit(
        `${opts.providerType}:${opts.project.slug}`,
        () => runCreationOperation(operationOpts, current, true),
      );

      if (result.success && result.issue) ready.push(result.issue.iid);
      else if (result.status === CREATION_RESULT_STATUS.MANUAL_REPAIR_REQUIRED) manual.push(result.operationId);
      else pending.push(result.operationId);
    });
  }

  return { ready, pending, manual };
}
