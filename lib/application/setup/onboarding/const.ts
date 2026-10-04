/** Stable setup identifiers owned by onboarding. */

/** Onboarding instruction scenarios. */
export const ONBOARDING_MODE = {
  FIRST_RUN: "first-run",
  RECONFIGURE: "reconfigure",
} as const;

/** Instruction markers used only to choose the onboarding scenario. */
export const WORKSPACE_INSTRUCTION_MARKERS = ["DevClaw", "task_start"] as const;
