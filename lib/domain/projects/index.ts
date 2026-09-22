/** Exposes supported project and worker-slot semantics to the domain package. */
export {
  countActiveSlots,
  emptyRoleWorkerState,
  emptySlot,
  findFreeSlot,
  findSlotByIssue,
  reconcileSlots,
} from "./slots.js";
export type { Project, RoleWorkerState, SlotLocation, SlotState } from "./types.js";
