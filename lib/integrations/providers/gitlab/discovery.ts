/** Owns GitLab discovery operations and their provider-specific API semantics. */

import { PROVIDER_ISSUE_LOOKUP_ERROR } from "../const.js";
import { classifyProviderLookupFailure, ProviderIssueLookupError } from "../lookup-errors.js";
import { parseProviderJson } from "../schema.js";
import type { ProviderTransport } from "../types.js";
import { GITLAB_API_RESOURCE,GITLAB_MERGEABILITY, GITLAB_REQUEST_STATE } from "./const.js";
import { gitlabApiPath } from "./endpoints.js";
import { GitLabRepository } from "./repository.js";
import { GitLabMergeabilitySchema, GitLabMRSchema } from "./schema.js";
import type { GitLabMR } from "./types.js";

/** Implements the discovery capability using dependencies shared by one adapter instance. */
export class GitLabDiscovery {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   * @param repository - Shared repository capability for this adapter.
   */
  constructor(private readonly transport: ProviderTransport, private readonly repository: GitLabRepository) {}

  /** Read and validate related MRs; transport and malformed-response failures never imply absence.
   * @param issueId - Managed issue whose related merge requests are requested.
   */
  async getRelatedMRs(issueId: number): Promise<GitLabMR[]> {
    const mrs = await this.transport.collection(gitlabApiPath(GITLAB_API_RESOURCE.ISSUES, issueId, GITLAB_API_RESOURCE.RELATED_MERGE_REQUESTS), GitLabMRSchema);

    if (!mrs.length) return [];
    const projectId = await this.repository.getProjectId();

    return mrs.filter(mr => mr.project_id === projectId).sort((a, b) => b.iid - a.iid);
  }

  /** Resolve the exact observed MR instead of redirecting work to a newer candidate.
   * @param issueId - Managed issue whose related open requests are searched.
   * @param prUrl - Optional exact URL previously observed by the application.
   */
  async selectOpenMr(issueId: number, prUrl?: string): Promise<GitLabMR | undefined> {
    const candidates = (await this.getRelatedMRs(issueId)).filter(mr => mr.state === GITLAB_REQUEST_STATE.OPEN);
    const selected = prUrl ? candidates.find(mr => mr.web_url === prUrl) : candidates[0];

    if (prUrl && !selected) throw new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN, provider: "gitlab",
      retryable: false, message: `Previously selected MR is no longer available as an open request: ${prUrl}` });

    return selected;
  }

  /** Check MR merge status for conflicts.
   * @param mrIid - Provider-local IID of the exact selected merge request.
   */
  async isMrMergeable(mrIid: number): Promise<boolean | undefined> {
    try {
      const raw = await this.transport.read(["api", `${gitlabApiPath(GITLAB_API_RESOURCE.MERGE_REQUESTS, mrIid)}?include_rebase_in_progress=true`]);
      const mr = parseProviderJson(raw, GitLabMergeabilitySchema);

      if (mr.has_conflicts === true) return false;
      if (mr.detailed_merge_status === GITLAB_MERGEABILITY.CONFLICT) return false;
      if (mr.detailed_merge_status === GITLAB_MERGEABILITY.MERGEABLE || mr.detailed_merge_status === GITLAB_MERGEABILITY.CI_REQUIRED) return true;

      return undefined; // Unknown
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }
}
