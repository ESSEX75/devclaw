/** Names of durable checkpoints in the managed-task creation saga. */

export const CREATION_STEPS = {
  PREFLIGHT: "preflight_completed",
  PROVIDER_STARTED: "provider_create_started",
  PROVIDER_CREATED: "provider_created",
  PROJECTION_VERIFIED: "projection_verified",
  LOCAL_COMMITTED: "local_state_committed",
  READY: "ready",
} as const;
