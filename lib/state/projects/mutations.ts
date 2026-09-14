/**
 * projects/mutations.ts — State mutations for project worker slots.
 */
import type { SlotState } from "../../domain/index.js";
import { emptySlot, findFreeSlot, findSlotByIssue } from "../../domain/index.js";
import { resolveProjectSlug } from "./queries.js";
import { updateProjects } from "./repository.js";
import type { ProjectsData } from "./types.js";

/**
 * Update a specific slot in a role's worker state.
 * Uses file locking to prevent concurrent read-modify-write races.
 *
 * @param workspaceDir - Workspace containing the project registry.
 * @param slugOrChannelId - Project slug or routed channel identifier.
 * @param role - Configured role whose slot is updated.
 * @param level - Configured level containing the slot.
 * @param slotIndex - Zero-based slot position to update.
 * @param updater - Pure slot replacement operation.
 */
export async function updateSlot(
  workspaceDir: string,
  slugOrChannelId: string,
  role: string,
  level: string,
  slotIndex: number,
  updater: (slot: SlotState) => SlotState,
): Promise<ProjectsData> {
  return updateProjects(workspaceDir, (current) => {
    const data = structuredClone(current);
    const slug = resolveProjectSlug(data, slugOrChannelId);

    if (!slug) {
      throw new Error(`Project not found for slug or channelId: ${slugOrChannelId}`);
    }

    const project = data.projects[slug]!;
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
 * Accepts slug or channelId (dual-mode).
 *
 * @param workspaceDir - Workspace containing the project registry.
 * @param slugOrChannelId - Project slug or routed channel identifier.
 * @param role - Configured role whose worker becomes active.
 * @param params - Worker assignment and slot-selection values.
 */
export async function activateWorker(
  workspaceDir: string,
  slugOrChannelId: string,
  role: string,
  params: {
    issueId: number;
    level: string;
    sessionKey?: string;
    startTime?: string;
    /** Label the issue had before transitioning to the active state (e.g. "To Do", "To Improve"). */
    previousLabel?: string;
    /** Slot index within the level's array. If omitted, finds first free slot. */
    slotIndex?: number;
    /** Deterministic fun name for this slot. */
    name?: string;
  },
): Promise<ProjectsData> {
  return updateProjects(workspaceDir, (current) => {
    const data = structuredClone(current);
    const slug = resolveProjectSlug(data, slugOrChannelId);

    if (!slug) {
      throw new Error(`Project not found for slug or channelId: ${slugOrChannelId}`);
    }

    const project = data.projects[slug]!;
    const rw = project.workers[role] ?? { levels: {} };

    if (!rw.levels[params.level]) rw.levels[params.level] = [];
    const slots = rw.levels[params.level]!;

    const idx = params.slotIndex ?? findFreeSlot(rw, params.level) ?? 0;

    // Ensure slot exists
    while (slots.length <= idx) {
      slots.push(emptySlot());
    }

    slots[idx] = {
      active: true,
      issueId: params.issueId,
      sessionKey: params.sessionKey ?? slots[idx]!.sessionKey,
      startTime: params.startTime ?? new Date().toISOString(),
      previousLabel: params.previousLabel ?? null,
      name: params.name ?? slots[idx]!.name,
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
 * Accepts slug or channelId (dual-mode).
 *
 * @param workspaceDir - Workspace containing the project registry.
 * @param slugOrChannelId - Project slug or routed channel identifier.
 * @param role - Configured role whose worker becomes inactive.
 * @param opts - Optional issue or explicit slot selector.
 */
export async function deactivateWorker(
  workspaceDir: string,
  slugOrChannelId: string,
  role: string,
  opts?: { level?: string; slotIndex?: number; issueId?: number },
): Promise<ProjectsData> {
  return updateProjects(workspaceDir, (current) => {
    const data = structuredClone(current);
    const slug = resolveProjectSlug(data, slugOrChannelId);

    if (!slug) {
      throw new Error(`Project not found for slug or channelId: ${slugOrChannelId}`);
    }

    const project = data.projects[slug]!;
    const rw = project.workers[role] ?? { levels: {} };

    let level: string | undefined;
    let idx: number | undefined;

    if (opts?.level !== undefined && opts?.slotIndex !== undefined) {
      level = opts.level;
      idx = opts.slotIndex;
    } else if (opts?.issueId) {
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
