/** Exposes managed projection reconciliation to application use cases. */

export { applyManagedLabelDiff, countManagedLabelMutationRequests } from "./apply.js";
export { reconcileManagedLabels, reconcileManagedLabelsLocked } from "./coordinator.js";
export type { ApplyManagedLabelDiffInput, ManagedProjectionResult, ProjectionProvider, ReconcileManagedLabelsInput } from "./types.js";
