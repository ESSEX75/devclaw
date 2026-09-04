/**
 * Validates project notification routes against the live OpenClaw configuration.
 * The application layer owns this cross-store check because it combines project state
 * with configured agents, channel accounts, and bindings.
 */
import type { NotificationEndpoint, Project, ProjectsData } from "../../domain/index.js";

/** Read-only OpenClaw configuration surface required for route validation. */
export type RouteConfig = {
  readonly agents?: { readonly list?: readonly { readonly id: string }[] };
  readonly channels?: Readonly<Record<string, {
    readonly enabled?: boolean;
    readonly accounts?: Readonly<Record<string, unknown>>;
  }>>;
  readonly bindings?: readonly {
    readonly agentId: string;
    readonly match?: {
      readonly channel?: string;
      readonly accountId?: string;
      readonly peer?: { readonly id?: string };
    };
  }[];
};

/** Stable diagnostic codes produced by strict route validation. */
export const ROUTE_DIAGNOSTIC_CODE = {
  AGENT_NOT_FOUND: "route.agent_not_found",
  CHANNEL_NOT_FOUND: "route.channel_not_found",
  CHANNEL_DISABLED: "route.channel_disabled",
  ACCOUNT_NOT_FOUND: "route.account_not_found",
  BINDING_NOT_FOUND: "route.binding_not_found",
  BINDING_AGENT_MISMATCH: "route.binding_agent_mismatch",
  DESTINATION_CONFLICT: "route.destination_conflict",
} as const;

/** One machine-readable route validation failure. */
export type RouteDiagnostic = {
  /** Stable code suitable for CLI and automation handling. */
  code: string;
  /** Human-readable explanation including the invalid route component. */
  message: string;
};

/** Build the OpenClaw peer identifier represented by a project endpoint. */
export function getEndpointPeerId(endpoint: NotificationEndpoint): string {
  return endpoint.threadId
    ? `${endpoint.channelId}:topic:${endpoint.threadId}`
    : endpoint.channelId;
}

/** Inspect an endpoint without mutating either OpenClaw or project state. */
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

/** Inspect an exact OpenClaw account and peer binding without mutation. */
export function inspectExactRoute(
  config: RouteConfig,
  agentId: string,
  channel: string,
  accountId: string,
  peerId: string,
): RouteDiagnostic[] {
  const diagnostics: RouteDiagnostic[] = [];
  const agent = config.agents?.list?.find((candidate) => candidate.id === agentId);

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

  if (!channelConfig.accounts?.[accountId]) {
    diagnostics.push({
      code: ROUTE_DIAGNOSTIC_CODE.ACCOUNT_NOT_FOUND,
      message: `Account "${accountId}" is not configured for channel "${channel}".`,
    });
  }

  const matchingDestination = (config.bindings ?? []).find((binding) => (
    binding.match?.channel === channel
    && binding.match.accountId === accountId
    && binding.match.peer?.id === peerId
  ));

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

/** Require a valid exact OpenClaw account and peer binding. */
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

/** Require a valid exact OpenClaw route before persisting or using an endpoint. */
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

/** Reject an endpoint already owned by another project. */
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

/** Inspect every persisted project endpoint against the current OpenClaw configuration. */
export function inspectConfiguredProjectRoutes(
  config: RouteConfig,
  data: ProjectsData,
): Array<{ project: Pick<Project, "slug" | "name" | "agentId">; endpoint: NotificationEndpoint; diagnostics: RouteDiagnostic[] }> {
  const results: Array<{
    project: Pick<Project, "slug" | "name" | "agentId">;
    endpoint: NotificationEndpoint;
    diagnostics: RouteDiagnostic[];
  }> = [];

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
