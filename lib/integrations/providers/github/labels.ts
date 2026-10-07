/** Owns GitHub labels operations and their provider-specific API semantics. */

import type { ProviderTransport } from "../types.js";

/** Implements the labels capability using dependencies shared by one adapter instance. */
export class GitHubLabels {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   */
  constructor(private readonly transport: ProviderTransport) {}

  /** Apply the exact application-selected label name and color idempotently.
   * @param name - Exact provider label name selected by application configuration.
   * @param color - Configured provider label color.
   */
  async ensureLabel(name: string, color: string): Promise<void> {
    await this.transport.write(["label", "create", name, "--color", color.replace(/^#/, ""), "--force"]);
  }

  /** Add only the explicit application-selected provider label.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param label - Exact provider label used as an observation filter or explicit mutation target.
   */
  async addLabel(issueId: number, label: string): Promise<void> {
    await this.transport.write(["issue", "edit", String(issueId), "--add-label", label]);
  }

  /** Remove only explicitly selected labels; an empty set has no external effects.
   * @param issueId - Provider-local issue identity within the configured repository.
   * @param labels - Explicit provider-visible label names; never authoritative workflow state.
   */
  async removeLabels(issueId: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const args = ["issue", "edit", String(issueId)];

    for (const l of labels) args.push("--remove-label", l);
    await this.transport.write(args);
  }

  /** Add only the labels explicitly selected by application, without interpreting workflow state.
   * @param issueId - Provider-local issue.
   * @param labels - Exact label names to add.
   */
  async addLabels(issueId: number, labels: string[]): Promise<void> {
    if (!labels.length) return;
    const args = ["issue", "edit", String(issueId)];

    for (const label of labels) args.push("--add-label", label);
    await this.transport.write(args);
  }

}
