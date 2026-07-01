/**
 * Health service — worker health checks and auto-fix.
 *
 * Triangulates THREE sources of truth:
 *   1. projects.json — worker state (active, issueId, sessions per level)
 *   2. Issue label — current GitHub/GitLab label (from workflow config)
 *   3. Session state — whether the OpenClaw session exists via gateway status (including abortedLastRun flag)
 *
 * Detection matrix:
 *   | projects.json | Issue label       | Session state           | Action                                    |
 *   |---------------|-------------------|-------------------------|-------------------------------------------|
 *   | active        | Active label      | abortedLastRun: true    | HEAL: Revert to queue + clear session     |
 *   | active        | Active label      | dead/missing            | Deactivate worker, revert to queue        |
 *   | active        | NOT Active label  | any                     | Deactivate worker (moved externally)      |
 *   | active        | Active label      | alive + normal          | Healthy (flag if stale >2h)               |
 *   | inactive      | Active label      | any                     | Revert issue to queue (label stuck)       |
 *   | inactive      | issueId set       | any                     | Clear issueId (warning)                   |
 *   | active        | issue deleted     | any                     | Deactivate worker, clear state            |
 *
 * Session state notes:
 *   - gateway status `sessions.recent` is capped at 10 entries. We avoid this cap by
 *     reading session keys directly from the session files listed in `sessions.paths`.
 *   - Grace period: workers activated within the last GRACE_PERIOD_MS are never
 *     considered session-dead (they may not appear in sessions yet).
 *   - abortedLastRun: indicates session hit context limit (#287, #290) — triggers immediate healing.
 */
import type { StateLabel, IssueProvider, Issue } from "../../../providers/provider.js";
import {
  getRoleWorker,
  updateSlot,
  deactivateWorker,
} from "../../../projects/index.js";
import type { Project } from "../../../projects/index.js";
import { log as auditLog } from "../../../audit.js";
import {
  DEFAULT_WORKFLOW,
} from "../../../domain/workflow/defaults.js";
import {
  getActiveLabel,
  getRevertLabel,
  hasWorkflowStates,
  getCurrentStateLabel,
} from "../../../domain/workflow/queries.js";
import type {
  WorkflowConfig,
  Role,
} from "../../../domain/workflow/types.js";
import { isSessionAlive, type SessionLookup } from "./gateway-sessions.js";
import { sendToAgent } from "../../../dispatch/session.js";
import type { RunCommand } from "../../../context.js";
import {
  GRACE_PERIOD_MS,
  NUDGE_MESSAGE,
  STALL_CONTEXT_THRESHOLD,
} from "./types.js";
import type { HealthFix } from "./types.js";
import { fetchIssue, isIssueClosed } from "./issue-utils.js";

// ---------------------------------------------------------------------------
// Health check logic
// ---------------------------------------------------------------------------


export async function checkWorkerHealth(opts: {
  workspaceDir: string;
  projectSlug: string;
  project: Project;
  role: Role;
  autoFix: boolean;
  provider: IssueProvider;
  sessions: SessionLookup | null;
  /** Workflow config (defaults to DEFAULT_WORKFLOW) */
  workflow?: WorkflowConfig;
  /** Hours after which an active worker is considered stale (default: 2) */
  staleWorkerHours?: number;
  /** Minutes of session inactivity before stall detection (default: 15) */
  stallTimeoutMinutes?: number;
  /** Required for sending nudge messages to stalled sessions */
  runCommand: RunCommand;
  /** Agent ID for sendToAgent calls */
  agentId?: string;
}): Promise<HealthFix[]> {
  const {
    workspaceDir, projectSlug, project, role, autoFix, provider, sessions,
    workflow = DEFAULT_WORKFLOW,
    staleWorkerHours = 2,
  } = opts;

  const fixes: HealthFix[] = [];

  // Skip roles without workflow states (e.g. architect — tool-triggered only)
  if (!hasWorkflowStates(workflow, role)) return fixes;

  const roleWorker = getRoleWorker(project, role);

  // Get labels from workflow config
  const expectedLabel = getActiveLabel(workflow, role);
  const queueLabel = getRevertLabel(workflow, role);

  // Iterate over all levels and their slots
  for (const [level, slots] of Object.entries(roleWorker.levels)) {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex]!;
      const sessionKey = slot.sessionKey;

      // Use the label stored at dispatch time (previousLabel) if available
      const slotQueueLabel: string = slot.previousLabel ?? queueLabel;

      // Grace period: skip session liveness checks for recently-started workers
      const workerStartTime = slot.startTime ? new Date(slot.startTime).getTime() : null;
      const withinGracePeriod = workerStartTime !== null && (Date.now() - workerStartTime) < GRACE_PERIOD_MS;

      // Parse issueId
      const issueIdNum = slot.issueId ? Number(slot.issueId) : null;

      // Fetch issue state if we have an issueId
      let issue: Issue | null = null;
      let currentLabel: StateLabel | null = null;
      if (issueIdNum) {
        issue = await fetchIssue(provider, issueIdNum);
        currentLabel = issue ? getCurrentStateLabel(issue.labels, workflow) : null;
      }

      // Helper to revert label for this issue
      async function revertLabel(fix: HealthFix, from: StateLabel, to: StateLabel) {
        if (!issueIdNum) return;
        try {
          await provider.transitionLabel(issueIdNum, from, to);
          fix.labelReverted = `${from} → ${to}`;
        } catch {
          fix.labelRevertFailed = true;
        }
      }

      // Helper to deactivate this slot
      async function deactivateSlot() {
        await deactivateWorker(workspaceDir, projectSlug, role, {
          level,
          slotIndex,
          issueId: slot.issueId ?? undefined,
        });
      }

      // Case 6: Active but issue doesn't exist (deleted/closed externally)
      if (slot.active && issueIdNum && !issue) {
        const fix: HealthFix = {
          issue: {
            type: "issue_gone",
            severity: "critical",
            project: project.name,
            projectSlug,
            role,
            level,
            sessionKey,
            issueId: slot.issueId,
            slotIndex,
            message: `${role.toUpperCase()} ${level}[${slotIndex}] active but issue #${issueIdNum} no longer exists or is closed`,
          },
          fixed: false,
        };
        if (autoFix) {
          await deactivateSlot();
          fix.fixed = true;
        }
        fixes.push(fix);
        continue;
      }

      // Case 6b: Active but issue is closed (externally or by another process)
      // getIssue() returns closed issues on GitHub/GitLab, so Case 6 doesn't catch this.
      if (slot.active && issue && isIssueClosed(issue)) {
        const fix: HealthFix = {
          issue: {
            type: "issue_closed",
            severity: "critical",
            project: project.name,
            projectSlug,
            role,
            level,
            sessionKey,
            issueId: slot.issueId,
            slotIndex,
            message: `${role.toUpperCase()} ${level}[${slotIndex}] active but issue #${issueIdNum} is closed`,
          },
          fixed: false,
        };
        if (autoFix) {
          await deactivateSlot();
          fix.fixed = true;
        }
        fixes.push(fix);
        continue;
      }

      // Case 2: Active but issue label is NOT the expected in-progress label
      if (slot.active && issue && currentLabel !== expectedLabel) {
        const fix: HealthFix = {
          issue: {
            type: "label_mismatch",
            severity: "critical",
            project: project.name,
            projectSlug,
            role,
            level,
            sessionKey,
            issueId: slot.issueId,
            expectedLabel,
            actualLabel: currentLabel,
            slotIndex,
            message: `${role.toUpperCase()} ${level}[${slotIndex}] active but issue #${issueIdNum} has label "${currentLabel}" (expected "${expectedLabel}")`,
          },
          fixed: false,
        };
        if (autoFix) {
          await deactivateSlot();
          fix.fixed = true;
        }
        fixes.push(fix);
        continue;
      }

      // Case 1: Active with correct label but session is dead/missing
      if (slot.active && sessionKey && sessions && !withinGracePeriod && !isSessionAlive(sessionKey, sessions)) {
        const fix: HealthFix = {
          issue: {
            type: "session_dead",
            severity: "critical",
            project: project.name,
            projectSlug,
            role,
            sessionKey,
            level,
            issueId: slot.issueId,
            slotIndex,
            message: `${role.toUpperCase()} ${level}[${slotIndex}] active but session "${sessionKey}" not found in gateway`,
          },
          fixed: false,
        };
        if (autoFix) {
          await revertLabel(fix, expectedLabel, slotQueueLabel);
          await deactivateSlot();
          fix.fixed = true;
        }
        fixes.push(fix);
        continue;
      }

      // Case 1b: Active but no session key at all
      if (slot.active && !sessionKey) {
        const fix: HealthFix = {
          issue: {
            type: "session_dead",
            severity: "critical",
            project: project.name,
            projectSlug,
            role,
            level,
            issueId: slot.issueId,
            slotIndex,
            message: `${role.toUpperCase()} ${level}[${slotIndex}] active but no session key`,
          },
          fixed: false,
        };
        if (autoFix) {
          if (issue && currentLabel === expectedLabel) {
            await revertLabel(fix, expectedLabel, slotQueueLabel);
          }
          await deactivateSlot();
          fix.fixed = true;
        }
        fixes.push(fix);
        continue;
      }

      // Case 1c: Active with correct label but session hit context limit (abortedLastRun)
      if (slot.active && sessionKey && sessions && isSessionAlive(sessionKey, sessions)) {
        const session = sessions.get(sessionKey);
        if (session?.abortedLastRun) {
          const fix: HealthFix = {
            issue: {
              type: "context_overflow",
              severity: "critical",
              project: project.name,
              projectSlug,
              role,
              sessionKey,
              level,
              issueId: slot.issueId,
              expectedLabel,
              actualLabel: currentLabel,
              slotIndex,
              message: `${role.toUpperCase()} ${level}[${slotIndex}] session "${sessionKey}" hit context limit (abortedLastRun: true). Healing by reverting to queue.`,
            },
            fixed: false,
          };
          if (autoFix) {
            if (issue && currentLabel === expectedLabel) {
              await revertLabel(fix, expectedLabel, slotQueueLabel);
            }
            await deactivateSlot();
            fix.fixed = true;
          }
          fixes.push(fix);
          await auditLog(workspaceDir, "context_overflow_healed", {
            project: project.name,
            projectSlug,
            role,
            issueId: slot.issueId,
            sessionKey,
            level,
            slotIndex,
          }).catch(() => {});
          continue;
        }
      }

      // Case: Active with alive session but no recent activity (stalled)
      if (slot.active && sessionKey && sessions && !withinGracePeriod && isSessionAlive(sessionKey, sessions)) {
        const session = sessions.get(sessionKey)!;
        const stallThresholdMs = (opts.stallTimeoutMinutes ?? 15) * 60_000;
        const sessionIdleMs = Date.now() - (session.updatedAt || 0);

        if (sessionIdleMs > stallThresholdMs) {
          const idleMinutes = Math.round(sessionIdleMs / 60_000);
          const taskNeverArrived = (session.contextTokens ?? 0) < STALL_CONTEXT_THRESHOLD;

          const fix: HealthFix = {
            issue: {
              type: "session_stalled",
              severity: "critical",
              project: project.name,
              projectSlug,
              role,
              level,
              sessionKey,
              issueId: slot.issueId,
              slotIndex,
              message: taskNeverArrived
                ? `${role.toUpperCase()} ${level}[${slotIndex}] session idle ${idleMinutes}m, task likely never arrived — re-queuing`
                : `${role.toUpperCase()} ${level}[${slotIndex}] session idle ${idleMinutes}m — sending nudge`,
            },
            fixed: false,
          };

          if (autoFix) {
            if (taskNeverArrived) {
              // Task never arrived → revert label, deactivate, let next tick re-dispatch
              if (issue && currentLabel === expectedLabel) {
                await revertLabel(fix, expectedLabel, slotQueueLabel);
              }
              await deactivateSlot();
            } else {
              // Task arrived but worker stalled → nudge the session
              sendToAgent(sessionKey, NUDGE_MESSAGE, {
                agentId: opts.agentId,
                projectName: project.name,
                issueId: issueIdNum!,
                role,
                level,
                slotIndex,
                workspaceDir,
                runCommand: opts.runCommand,
              });
              fix.nudgeSent = true;
            }
            fix.fixed = true;
          }

          await auditLog(workspaceDir, "session_stalled", {
            project: project.name,
            projectSlug,
            role,
            level,
            sessionKey,
            issueId: slot.issueId,
            slotIndex,
            idleMinutes,
            taskNeverArrived,
            action: taskNeverArrived ? "requeue" : "nudge",
          }).catch(() => {});
          fixes.push(fix);
          continue;
        }
      }

      // Case 3: Active with correct label and alive session — check for staleness
      if (slot.active && slot.startTime && sessionKey && sessions && isSessionAlive(sessionKey, sessions)) {
        const hours = (Date.now() - new Date(slot.startTime).getTime()) / 3_600_000;
        if (hours > staleWorkerHours) {
          const fix: HealthFix = {
            issue: {
              type: "stale_worker",
              severity: "warning",
              project: project.name,
              projectSlug,
              role,
              hoursActive: Math.round(hours * 10) / 10,
              sessionKey,
              issueId: slot.issueId,
              slotIndex,
              message: `${role.toUpperCase()} ${level}[${slotIndex}] active for ${Math.round(hours * 10) / 10}h — may need attention`,
            },
            fixed: false,
          };
          if (autoFix) {
            await revertLabel(fix, expectedLabel, slotQueueLabel);
            await deactivateSlot();
            fix.fixed = true;
          }
          fixes.push(fix);
        }
      }

      // Case 4: Inactive but issue has stuck active label
      if (!slot.active && issue && currentLabel === expectedLabel) {
        const fix: HealthFix = {
          issue: {
            type: "stuck_label",
            severity: "critical",
            project: project.name,
            projectSlug,
            role,
            issueId: slot.issueId,
            expectedLabel: slotQueueLabel,
            actualLabel: currentLabel,
            slotIndex,
            message: `${role.toUpperCase()} ${level}[${slotIndex}] inactive but issue #${issueIdNum} still has "${currentLabel}" label`,
          },
          fixed: false,
        };
        if (autoFix) {
          await revertLabel(fix, expectedLabel, slotQueueLabel);
          // Clear the slot's issueId
          if (slot.issueId) {
            await updateSlot(workspaceDir, projectSlug, role, level, slotIndex, { issueId: null });
          }
          fix.fixed = true;
        }
        fixes.push(fix);
        continue;
      }

      // Case 5: Inactive but still has issueId set (orphan reference)
      if (!slot.active && slot.issueId) {
        const fix: HealthFix = {
          issue: {
            type: "orphan_issue_id",
            severity: "warning",
            project: project.name,
            projectSlug,
            role,
            issueId: slot.issueId,
            slotIndex,
            message: `${role.toUpperCase()} ${level}[${slotIndex}] inactive but still has issueId "${slot.issueId}"`,
          },
          fixed: false,
        };
        if (autoFix) {
          await updateSlot(workspaceDir, projectSlug, role, level, slotIndex, { issueId: null });
          fix.fixed = true;
        }
        fixes.push(fix);
      }
    }
  }

  return fixes;
}
