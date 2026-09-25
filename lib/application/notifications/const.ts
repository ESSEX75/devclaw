/** Owns the supported notification event identifiers used at the config boundary. */
import type { NotifyEvent } from "./types.js";

/** Event toggles accepted from plugin configuration. */
export const NOTIFICATION_EVENT_TYPES: ReadonlyArray<NotifyEvent["type"]> = [
  "pipelineComplete", "workerStart", "workerComplete", "reviewNeeded",
  "prMerged", "changesRequested", "mergeConflict", "prClosed",
];
