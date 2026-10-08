/** Exposes checked command execution and validated response decoding to provider capabilities. */

export { createProviderTransport } from "./client.js";
export { runProviderCommand } from "./command.js";
export { PROVIDER_CLI, PROVIDER_HTTP_METHOD, PROVIDER_PAGE_SIZE, PROVIDER_TRANSPORT_POLICY } from "./const.js";
export { parseProviderJson, ProviderIdentitySchema, ProviderResourceIdentitySchema } from "./schema.js";
export type { ProviderAdapterOptions, ProviderCli, ProviderTransport } from "./types.js";
