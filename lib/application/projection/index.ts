/** Exposes managed projection reconciliation to application use cases. */
export { applyManagedLabelDiff } from "./apply.js";
export { reconcileManagedLabels, reconcileManagedLabelsLocked } from "./coordinator.js";
export type { ApplyManagedLabelDiffInput, ManagedProjectionResult, ReconcileManagedLabelsInput } from "./types.js";
