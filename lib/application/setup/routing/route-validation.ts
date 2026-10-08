/**
 * Validates project notification routes against the live OpenClaw configuration.
 * The application layer owns this cross-store check because it combines project state
 * with configured agents, channel accounts, and bindings.
 */

import type { NotificationEndpoint } from "../../../domain/index.js";
import { findConfiguredAgent } from "../../../integrations/index.js";
import type { ProjectsData } from "../../../state/index.js";
import { ROUTE_DIAGNOSTIC_CODE, TOPIC_PEER_SEPARATOR } from "./const.js";
import { matchesExactDestination } from "./route-matching.js";
import type { ProjectRouteInspection, RouteConfig, RouteDiagnostic } from "./types.js";

/** Build the OpenClaw peer identifier represented by a project endpoint.
 * @param endpoint - Persisted direct, group, or topic destination.
 */
export function getEndpointPeerId(endpoint: NotificationEndpoint): string {
  return endpoint.threadId
    ? `${endpoint.channelId}${TOPIC_PEER_SEPARATOR}${endpoint.threadId}`
    : endpoint.channelId;
}

/** Inspect an endpoint without mutating either OpenClaw or project state.
 * @param config - Current SDK routing configuration.
 * @param agentId - Expected project owner.
 * @param endpoint - Persisted destination to inspect.
 */
export function inspectProjectRoute(
  config: RouteConfig,
  agentId: string,
  endpoint: NotificationEndpoint,
): RouteDiagnostic[] {
  return inspectExactRoute(
    config,
    agentId,
    endpoint.channel,
    endpoint.accountId,
    getEndpointPeerId(endpoint),
  );
}

/** Inspect an exact OpenClaw account and peer binding without mutation.
 * @param config - Current SDK routing configuration.
 * @param agentId - Expected route owner.
 * @param channel - Destination transport.
 * @param accountId - Configured channel account.
 * @param peerId - Exact direct, group, or topic identifier.
 */
export function inspectExactRoute(
  config: RouteConfig,
  agentId: string,
  channel: string,
  accountId: string,
  peerId: string,
): RouteDiagnostic[] {
  const diagnostics: RouteDiagnostic[] = [];
  const agent = findConfiguredAgent(config, agentId);

  if (!agent) {
    diagnostics.push({
      code: ROUTE_DIAGNOSTIC_CODE.AGENT_NOT_FOUND,
      message: `OpenClaw agent "${agentId}" does not exist.`,
    });
  }

  const channelConfig = config.channels?.[channel];

  if (!channelConfig) {
    diagnostics.push({
      code: ROUTE_DIAGNOSTIC_CODE.CHANNEL_NOT_FOUND,
      message: `OpenClaw channel "${channel}" is not configured.`,
    });

    return diagnostics;
  }

  if (channelConfig.enabled === false) {
    diagnostics.push({
      code: ROUTE_DIAGNOSTIC_CODE.CHANNEL_DISABLED,
      message: `OpenClaw channel "${channel}" is disabled.`,
    });
  }

  const account = channelConfig.accounts?.[accountId];

  if (!account) {
    diagnostics.push({
      code: ROUTE_DIAGNOSTIC_CODE.ACCOUNT_NOT_FOUND,
      message: `Account "${accountId}" is not configured for channel "${channel}".`,
    });
  }

  if (typeof account === "object" && account !== null && "enabled" in account && account.enabled === false) {
    diagnostics.push({ code: ROUTE_DIAGNOSTIC_CODE.ACCOUNT_DISABLED, message: `Account "${accountId}" is disabled for channel "${channel}".` });
  }

  const matches = (config.bindings ?? []).filter(binding => matchesExactDestination(binding, channel, accountId, peerId));
  const matchingDestination = matches[0];

  if (new Set(matches.map(binding => binding.agentId)).size > 1) {
    diagnostics.push({ code: ROUTE_DIAGNOSTIC_CODE.BINDING_CONFLICT, message: `Route ${channel}/${accountId}/${peerId} has conflicting agent bindings.` });
  }

  if (!matchingDestination) {
    diagnostics.push({
      code: ROUTE_DIAGNOSTIC_CODE.BINDING_NOT_FOUND,
      message: `No exact binding exists for ${channel}/${accountId}/${peerId}.`,
    });
  } else if (matchingDestination.agentId !== agentId) {
    diagnostics.push({
      code: ROUTE_DIAGNOSTIC_CODE.BINDING_AGENT_MISMATCH,
      message: `Route ${channel}/${accountId}/${peerId} is bound to agent "${matchingDestination.agentId}", not "${agentId}".`,
    });
  }

  return diagnostics;
}

/** Require a valid exact OpenClaw account and peer binding.
 * @param config - Current SDK routing configuration.
 * @param agentId - Expected route owner.
 * @param channel - Destination transport.
 * @param accountId - Configured channel account.
 * @param peerId - Exact direct, group, or topic identifier.
 */
export function validateExactRoute(
  config: RouteConfig,
  agentId: string,
  channel: string,
  accountId: string,
  peerId: string,
): void {
  const diagnostics = inspectExactRoute(config, agentId, channel, accountId, peerId);

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map((diagnostic) => `[${diagnostic.code}] ${diagnostic.message}`).join("\n"));
  }
}

/** Require a valid exact OpenClaw route before persisting or using an endpoint.
 * @param config - Current SDK routing configuration.
 * @param agentId - Expected project owner.
 * @param endpoint - Persisted destination to validate.
 */
export function validateProjectRoute(
  config: RouteConfig,
  agentId: string,
  endpoint: NotificationEndpoint,
): void {
  const diagnostics = inspectProjectRoute(config, agentId, endpoint);

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map((diagnostic) => `[${diagnostic.code}] ${diagnostic.message}`).join("\n"));
  }
}

/** Reject an endpoint already owned by another project.
 * @param data - Validated project registry.
 * @param targetProjectSlug - Project requesting the destination.
 * @param endpoint - Requested notification endpoint.
 */
export function validateDestinationAvailability(
  data: ProjectsData,
  targetProjectSlug: string,
  endpoint: NotificationEndpoint,
): void {
  const peerId = getEndpointPeerId(endpoint);

  for (const project of Object.values(data.projects)) {
    if (project.slug === targetProjectSlug) continue;

    const conflict = project.channels.some((candidate) => (
      candidate.channel === endpoint.channel
      && candidate.accountId === endpoint.accountId
      && getEndpointPeerId(candidate) === peerId
    ));

    if (conflict) {
      throw new Error(
        `[${ROUTE_DIAGNOSTIC_CODE.DESTINATION_CONFLICT}] Route `
        + `${endpoint.channel}/${endpoint.accountId}/${peerId} already belongs to project "${project.name}".`,
      );
    }
  }
}

/** Inspect every persisted project endpoint against the current OpenClaw configuration.
 * @param config - Current SDK routing configuration.
 * @param data - Validated project registry.
 */
export function inspectConfiguredProjectRoutes(
  config: RouteConfig,
  data: ProjectsData,
): ProjectRouteInspection[] {
  const results: ProjectRouteInspection[] = [];

  for (const project of Object.values(data.projects)) {
    for (const endpoint of project.channels) {
      results.push({
        project: { slug: project.slug, name: project.name, agentId: project.agentId },
        endpoint,
        diagnostics: inspectProjectRoute(config, project.agentId, endpoint),
      });
    }
  }

  return results;
}
