/**
 * projects/mutations.ts — State mutations for project worker slots.
 */
import type { SlotState } from "../../domain/index.js";
import { emptySlot, findFreeSlot, findSlotByIssue } from "../../domain/index.js";
import { updateProjects } from "./repository.js";
import type { ProjectsData } from "./types.js";

/** Parameters for activating a worker slot with a new task. */
type ActivateWorkerParams = {
  /** Provider-local issue assigned to the worker slot. */
  issueId: number;
  /** Configured role level whose slot should be activated. */
  level: string;
  /** Optional reusable OpenClaw session key assigned to the slot. */
  sessionKey?: string;
  /** Optional explicit activation timestamp. */
  startTime?: string;
  /** Label the issue had before transitioning to the active state (e.g. "To Do", "To Improve"). */
  previousLabel?: string;
  /** Slot index within the level's array. If omitted, finds first free slot. */
  slotIndex?: number;
  /** Deterministic fun name for this slot. */
  name?: string;
};

/** Options for locating and deactivating a worker slot. */
type DeactivateWorkerOptions = {
  /** Optional configured level containing the slot. */
  level?: string;
  /** Optional index of the slot within its level. */
  slotIndex?: number;
  /** Optional provider-local issue used to locate the active slot. */
  issueId?: number;
};

/**
 * Update a specific slot in a role's worker state.
 * Uses file locking to prevent concurrent read-modify-write races.
 *
 * @param workspaceDir - Workspace containing the project registry.
 * @param projectSlug - Canonical slug of the project whose slot is updated.
 * @param role - Configured role whose slot is updated.
 * @param level - Configured level containing the slot.
 * @param slotIndex - Zero-based slot position to update.
 * @param updater - Pure slot replacement operation.
 */
export async function updateSlot(
  workspaceDir: string,
  projectSlug: string,
  role: string,
  level: string,
  slotIndex: number,
  updater: (slot: SlotState) => SlotState,
): Promise<ProjectsData> {
  return updateProjects(workspaceDir, (current) => {
    const data = structuredClone(current);
    const project = data.projects[projectSlug];

    if (!project) throw new Error(`Project not found for slug: ${projectSlug}`);
    const rw = project.workers[role] ?? { levels: {} };

    if (!rw.levels[level]) rw.levels[level] = [];
    const slots = rw.levels[level]!;

    // Ensure slot exists
    while (slots.length <= slotIndex) {
      slots.push(emptySlot());
    }

    slots[slotIndex] = updater(slots[slotIndex]!);
    project.workers[role] = rw;

    return { data, result: data };
  });
}

/**
 * Mark a worker slot as active with a new task.
 * Routes by level to the correct slot array.
 * @param workspaceDir - Workspace containing the project registry.
 * @param projectSlug - Canonical slug of the project whose worker becomes active.
 * @param role - Configured role whose worker becomes active.
 * @param params - Worker assignment and slot-selection values.
 */
export async function activateWorker(
  workspaceDir: string,
  projectSlug: string,
  role: string,
  params: ActivateWorkerParams,
): Promise<ProjectsData> {
  return updateProjects(workspaceDir, (current) => {
    const data = structuredClone(current);
    const project = data.projects[projectSlug];

    if (!project) throw new Error(`Project not found for slug: ${projectSlug}`);
    const rw = project.workers[role] ?? { levels: {} };

    const slots = rw.levels[params.level] ?? [];

    rw.levels[params.level] = slots;

    const freeSlot = findFreeSlot(rw, params.level);
    const ownedSlot = slots.findIndex((slot) => slot.issueId === params.issueId);
    const idx = params.slotIndex
      ?? (ownedSlot >= 0 ? ownedSlot : freeSlot)
      ?? (slots.length === 0 ? 0 : null);

    if (idx === null) {
      throw new Error(`No free ${role}:${params.level} worker slot exists for project ${projectSlug}.`);
    }

    // Ensure slot exists
    while (slots.length <= idx) {
      slots.push(emptySlot());
    }

    const currentSlot = slots[idx]!;

    if ((currentSlot.active || currentSlot.issueId !== null) && currentSlot.issueId !== params.issueId) {
      throw new Error(
        `Worker slot ${role}:${params.level}:${idx} is already assigned to issue #${currentSlot.issueId ?? "unknown"}.`,
      );
    }

    slots[idx] = {
      active: true,
      issueId: params.issueId,
      sessionKey: params.sessionKey ?? currentSlot.sessionKey,
      startTime: params.startTime ?? new Date().toISOString(),
      previousLabel: params.previousLabel ?? null,
      name: params.name ?? currentSlot.name,
      lastIssueId: null,
    };

    project.workers[role] = rw;

    return { data, result: data };
  });
}

/**
 * Mark a worker slot as inactive after task completion.
 * Preserves sessionKey for session reuse.
 * Finds the slot by issueId (searches across all levels), or by explicit level+slotIndex.
 * @param workspaceDir - Workspace containing the project registry.
 * @param projectSlug - Canonical slug of the project whose worker becomes inactive.
 * @param role - Configured role whose worker becomes inactive.
 * @param opts - Optional issue or explicit slot selector.
 */
export async function deactivateWorker(
  workspaceDir: string,
  projectSlug: string,
  role: string,
  opts?: DeactivateWorkerOptions,
): Promise<ProjectsData> {
  return updateProjects(workspaceDir, (current) => {
    const data = structuredClone(current);
    const project = data.projects[projectSlug];

    if (!project) throw new Error(`Project not found for slug: ${projectSlug}`);
    const rw = project.workers[role] ?? { levels: {} };

    let level: string | undefined;
    let idx: number | undefined;

    if (opts?.level !== undefined && opts?.slotIndex !== undefined) {
      level = opts.level;
      idx = opts.slotIndex;
    } else if (opts?.issueId !== undefined) {
      const found = findSlotByIssue(rw, opts.issueId);

      if (found) {
        level = found.level;
        idx = found.slotIndex;
      }
    }

    if (level !== undefined && idx !== undefined) {
      const slots = rw.levels[level];

      if (slots && idx < slots.length) {
        const slot = slots[idx]!;

        if (opts?.issueId !== undefined && slot.issueId !== opts.issueId) {
          throw new Error(
            `Worker slot ${role}:${level}:${idx} belongs to issue #${slot.issueId ?? "none"}, not #${opts.issueId}.`,
          );
        }

        slots[idx] = {
          active: false,
          issueId: null,
          sessionKey: slot.sessionKey,
          startTime: null,
          previousLabel: null,
          name: slot.name,
          lastIssueId: slot.issueId,
        };
      }
    }

    project.workers[role] = rw;

    return { data, result: data };
  });
}
