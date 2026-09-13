/** Exposes active issue persistence to sibling state capabilities. */
export { confirmPipelineNotification, reservePipelineNotification, updateIssueRuntimeRecord, writeIssueRoleLevel } from "./mutations.js";
export { emptyIssueStateStore, readIssueStateStore, updateIssueStateStore, withIssueStoreLock, writeIssueStateStore } from "./repository.js";
export type { IssueStateStore, IssueStateUpdate } from "./types.js";
