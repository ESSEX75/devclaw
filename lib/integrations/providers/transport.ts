/** Shares checked CLI execution, replay policy and collection validation across one provider's capabilities. */

import type { z } from "zod";

import { runProviderCommand } from "./command.js";
import { PROVIDER_CLI, PROVIDER_COMMAND_MODE, PROVIDER_PAGE_SIZE } from "./const.js";
import { classifyProviderLookupFailure } from "./lookup-errors.js";
import { classifyProviderOperationError } from "./operation-errors.js";
import { parseProviderPages } from "./pagination.js";
import { createProviderPolicy, withResilience } from "./resilience.js";
import type { ProviderAdapterOptions, ProviderCli, ProviderTransport } from "./types.js";

/** Bind all capabilities to a single isolated retry/breaker policy; non-replayable writes execute once.
 * @param opts - Confirmed repository and plugin-owned process transport.
 * @param cli - Concrete provider CLI whose collection framing is known.
 */
export function createProviderTransport(opts: ProviderAdapterOptions, cli: ProviderCli): ProviderTransport {
  const { repoPath, runCommand } = opts;
  const policy = createProviderPolicy();
  const provider = cli === PROVIDER_CLI.GITHUB ? "github" : "gitlab";
  const transport: ProviderTransport = {
    repoPath,
    runCommand,
    /** Read through the instance's classified retry policy.
     * @param args - Read-only CLI argument vector.
     */
    read(args) {
      return withResilience(PROVIDER_COMMAND_MODE.READ, policy, () => runProviderCommand(runCommand, [cli, ...args], repoPath));
    },
    /** Repeat only explicit idempotent state setters.
     * @param args - Desired-state mutation arguments.
     */
    write(args) {
      return withResilience(PROVIDER_COMMAND_MODE.IDEMPOTENT, policy, () => transport.once(args));
    },
    /** Submit one mutation without replaying an uncertain outcome.
     * @param args - Non-replayable mutation arguments.
     */
    async once(args) {
      try { return await runProviderCommand(runCommand, [cli, ...args], repoPath); }
      catch (error) { throw classifyProviderOperationError(error); }
    },
    /** Read all CLI-managed pages, rejecting malformed or incomplete collections.
     * @param endpoint - Provider REST collection endpoint and optional query.
     * @param schema - Provider-owned record boundary schema.
     */
    async collection<T>(endpoint: string, schema: z.ZodType<T>): Promise<T[]> {
      try {
        const separator = endpoint.includes("?") ? "&" : "?";
        const args = ["api", `${endpoint}${separator}per_page=${PROVIDER_PAGE_SIZE}`, "--paginate"];

        if (cli === PROVIDER_CLI.GITHUB) args.push("--slurp");

        return parseProviderPages(await transport.read(args), schema, cli === PROVIDER_CLI.GITHUB);
      } catch (error) { throw classifyProviderLookupFailure(provider, error); }
    },
  };

  return transport;
}
