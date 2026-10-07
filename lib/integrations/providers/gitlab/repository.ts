/** Owns GitLab repository operations and their provider-specific API semantics. */

import { z } from "zod";

import { classifyProviderLookupFailure } from "../lookup-errors.js";
import type {
  ProviderTransport,
} from "../types.js";

/** Implements the repository capability using dependencies shared by one adapter instance. */
export class GitLabRepository {
  /** Successful provider-local project identity cache. */
  private projectId: number | undefined;
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   */
  constructor(private readonly transport: ProviderTransport) {}

  /** Resolve the owning project; failures never enter the identity cache. */
  async getProjectId(): Promise<number> {
    if (this.projectId !== undefined) return this.projectId;
    try {
      const response: unknown = JSON.parse(await this.transport.read(["api", "projects/:id"]));
      const project = z.object({ id: z.number().int().positive().safe() }).parse(response);

      this.projectId = project.id;

      return project.id;
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }
}
