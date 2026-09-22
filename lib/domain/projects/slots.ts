/**
 * projects/slots.ts — Pure slot helpers (no I/O).
 */
import type { RoleWorkerState, SlotLocation, SlotState } from "./types.js";

// ---------------------------------------------------------------------------
// Slot helpers
// ---------------------------------------------------------------------------

/** Create an empty (inactive) slot. */
export function emptySlot(): SlotState {
  return {
    active: false,
    issueId: null,
    sessionKey: null,
    startTime: null,
  };
}

/**
 * Create a blank role-worker state with the configured per-level capacities.
 *
 * @param levelMaxWorkers - Maximum slot count keyed by resolved level identifier.
 */
export function emptyRoleWorkerState(
  levelMaxWorkers: Partial<Record<string, number>>,
): RoleWorkerState {
  const levels: Partial<Record<string, SlotState[]>> = {};

  for (const [level, max] of Object.entries(levelMaxWorkers)) {
    if (max === undefined) continue;

    levels[level] = [];
    for (let i = 0; i < max; i++) {
      levels[level]!.push(emptySlot());
    }
  }

  return { levels };
}

/**
 * Return the lowest-index inactive slot within a specific level, or null if full.
 *
 * @param roleWorker - Role-owned worker slots to inspect.
 * @param level - Resolved level identifier whose slots should be searched.
 */
export function findFreeSlot(roleWorker: RoleWorkerState, level: string): number | null {
  const slots = roleWorker.levels[level];

  if (!slots) return null;
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i]!.active) return i;
  }

  return null;
}

/**
 * Reconcile a role's levels with the configured per-level maxWorkers.
 * - Adds missing levels, expands short arrays, shrinks idle trailing slots.
 * - Removes unconfigured levels after all of their slots become inactive.
 * Active workers are never removed — they finish naturally.
 * Mutates roleWorker in place. Returns true if any changes were made.
 *
 * @param roleWorker - Mutable role-owned worker state to reconcile.
 * @param levelMaxWorkers - Desired maximum slot count keyed by level identifier.
 */
export function reconcileSlots(
  roleWorker: RoleWorkerState,
  levelMaxWorkers: Partial<Record<string, number>>,
): boolean {
  let changed = false;
  const configuredLevels = new Set<string>();

  for (const [level, max] of Object.entries(levelMaxWorkers)) {
    if (max === undefined) continue;
    configuredLevels.add(level);

    if (!roleWorker.levels[level]) {
      roleWorker.levels[level] = [];
    }

    const slots = roleWorker.levels[level]!;

    while (slots.length < max) {
      slots.push(emptySlot());
      changed = true;
    }

    while (slots.length > max) {
      const last = slots[slots.length - 1]!;

      if (last.active) break;
      slots.pop();
      changed = true;
    }
  }

  for (const [level, slots] of Object.entries(roleWorker.levels)) {
    if (configuredLevels.has(level) || slots === undefined) continue;
    if (slots.some((slot) => slot.active)) continue;

    delete roleWorker.levels[level];
    changed = true;
  }

  return changed;
}

/**
 * Find the level and slot index for a given issue ID, or null if not found.
 *
 * @param roleWorker - Role-owned worker slots to inspect.
 * @param issueId - Stable issue identifier assigned to the requested slot.
 */
export function findSlotByIssue(roleWorker: RoleWorkerState, issueId: number): SlotLocation | null {
  for (const [level, slots] of Object.entries(roleWorker.levels)) {
    if (slots === undefined) continue;

    for (let i = 0; i < slots.length; i++) {
      if (slots[i]!.issueId === issueId) return { level, slotIndex: i };
    }
  }

  return null;
}

/**
 * Count the number of active slots across all levels.
 *
 * @param roleWorker - Role-owned worker slots to count.
 */
export function countActiveSlots(roleWorker: RoleWorkerState): number {
  let count = 0;

  for (const slots of Object.values(roleWorker.levels)) {
    if (slots === undefined) continue;

    for (const slot of slots) {
      if (slot.active) count++;
    }
  }

  return count;
}
