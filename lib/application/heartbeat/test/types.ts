/** Inputs owned by the heartbeat test-skip pass. */

import type { Project, WorkflowConfig } from "../../../domain/index.js";
import type { IssueProvider } from "../../../integrations/providers/index.js";

/** Context for transitioning locally managed issues that skip the test queue. */
export type TestSkipPassInput = {
  /** Workspace containing authoritative issue runtime state. */
  workspaceDir: string;
  /** Project name recorded in test-skip audit entries. */
  projectName: string;
  /** Project identity and provider routing used by transitions. */
  project: Pick<Project, "slug" | "channels" | "provider">;
  /** Resolved workflow that selects test queue states and transitions. */
  workflow: WorkflowConfig;
  /** Provider used for current observations and configured actions. */
  provider: IssueProvider;
};
