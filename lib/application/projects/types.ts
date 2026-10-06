/** Shared contracts for an unambiguous project and persisted notification route. */

import type { NotificationEndpoint, Project } from "../../domain/index.js";
import type { ProjectsData } from "../../state/index.js";

/** Complete route identity used to match a project endpoint without guessing. */
export type ProjectRoute = {
  /** Messaging transport, such as telegram or slack. */
  channel: string;
  /** Explicit account owning the endpoint. */
  accountId: string;
  /** Conversation identifier without a topic suffix. */
  channelId: string;
  /** Exact topic or thread, absent for an unthreaded conversation. */
  threadId?: string;
};

/** One project and endpoint selected from a strict registry snapshot. */
export type ProjectContext = {
  /** Validated registry used for the selection. */
  data: ProjectsData;
  /** Sole owning project. */
  project: Project;
  /** Sole matched endpoint; callers can persist its binding directly. */
  endpoint: NotificationEndpoint;
};
