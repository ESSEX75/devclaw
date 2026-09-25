/** Exposes worker dispatch and completion commands to their callers. */
export { WORKER_DELIVERY_RESOLUTION } from "./const.js";
export { dispatchTask, dispatchTaskLocked } from "./dispatch-task.js";
export { finishWork } from "./finish-work.js";
export { reconcileUncertainDispatch } from "./reconcile-delivery.js";
export { resolveWorkerDelivery } from "./resolve-delivery.js";
export type { DispatchOpts, DispatchResult } from "./types.js";
export type { ResolveWorkerDeliveryInput, ResolveWorkerDeliveryResult } from "./types.js";
