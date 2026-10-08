/**
 * Aggregates the provider submodules' supported APIs for external consumers.
 * Each owning submodule selects its exports; implementations use owner entrypoints to keep composition acyclic.
 */

export * from "./attachments/index.js";
export * from "./contracts/index.js";
export * from "./errors/index.js";
export * from "./git/index.js";
export * from "./github/index.js";
export * from "./gitlab/index.js";
export * from "./selection/index.js";
export * from "./transport/index.js";
