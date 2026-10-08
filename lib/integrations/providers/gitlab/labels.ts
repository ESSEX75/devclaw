/** Owns GitLab labels operations and their provider-specific API semantics. */

import { PROVIDER_OPERATION_ERROR } from "../errors/index.js";
import { classifyProviderOperationError } from "../errors/index.js";
import type { ProviderTransport } from "../transport/index.js";
import { PROVIDER_HTTP_METHOD } from "../transport/index.js";
import { GITLAB_API_RESOURCE } from "./const.js";
import { gitlabApiPath } from "./endpoints.js";

/** Implements the labels capability using dependencies shared by one adapter instance. */
export class GitLabLabels {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   */
  constructor(private readonly transport: ProviderTransport) {}

  /** Apply the exact application-selected label name and color idempotently.
   * @param name - Exact provider label name selected by application configuration.
   * @param color - Configured provider label color.
   */
  async ensureLabel(name: string, color: string): Promise<void> {
    try {
      // Update-first: always set the color on existing labels
      await this.transport.write([
        "api", gitlabApiPath(GITLAB_API_RESOURCE.LABELS, encodeURIComponent(name)),
        "--method", PROVIDER_HTTP_METHOD.PUT,
        "--field", `color=${color}`,
      ]);
    } catch (error) {
      const failure = classifyProviderOperationError(error);

      if (failure.code !== PROVIDER_OPERATION_ERROR.NOT_FOUND || failure.outcomeUnknown) throw error;
      // A confirmed missing label permits one create request.
      await this.transport.once([
        "api", gitlabApiPath(GITLAB_API_RESOURCE.LABELS),
        "--method", PROVIDER_HTTP_METHOD.POST,
        "--field", `name=${name}`,
        "--field", `color=${color}`,
      ]);
    }
  }

  /** Add only the explicit application-selected provider label.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param label - Exact provider label used as an observation filter or explicit mutation target.
   */
  async addLabel(issueId: number, label: string): Promise<void> {
    await this.transport.write(["issue", "update", String(issueId), "--label", label]);
  }

  /** Remove only explicitly selected labels; an empty set has no external effects.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param labels - Explicit provider-visible label names; never authoritative workflow state.
   */
  async removeLabels(issueId: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const args = ["issue", "update", String(issueId)];

    for (const l of labels) args.push("--unlabel", l);
    await this.transport.write(args);
  }

  /** Add only the labels explicitly selected by application, without interpreting workflow state.
   * @param issueId - Provider-local issue.
   * @param labels - Exact label names to add.
   */
  async addLabels(issueId: number, labels: string[]): Promise<void> {
    if (!labels.length) return;
    const args = ["issue", "update", String(issueId)];

    for (const label of labels) args.push("--label", label);
    await this.transport.write(args);
  }

}
