/** Contracts owned by setup routing. */

import type { NOTIFICATION_CHANNEL, NotificationChannel, NotificationEndpoint, Project } from "../../../domain/index.js";
import type { ValueOf } from "../../../types.js";
import type { ROUTE_DIAGNOSTIC_CODE } from "./const.js";

/** Supported notification transports for setup binding requests. */
export type SetupNotificationChannel = Extract<
  NotificationChannel,
  typeof NOTIFICATION_CHANNEL.TELEGRAM | typeof NOTIFICATION_CHANNEL.WHATSAPP
>;

/** Configured agent identity used by route inspection. */
type RouteAgent = {
  /** Stable configured identifier. */
  readonly id: string;
};

/** Channel availability and account inventory. */
type RouteChannel = {
  /** Explicit channel disablement takes precedence over account configuration. */
  readonly enabled?: boolean;
  /** Channel-specific settings remain unknown until inspected. */
  readonly accounts?: Readonly<Record<string, unknown>>;
};

/** Exact peer identity; absent or mismatched kinds do not establish a route. */
type RoutePeer = {
  /** SDK peer kind. */
  readonly kind?: string;
  /** Peer identifier, optionally qualified with a topic. */
  readonly id?: string;
};

/** Configured route matching fields. */
type RouteMatch = {
  /** Notification transport. */
  readonly channel?: string;
  /** Explicit configured account. */
  readonly accountId?: string;
  /** Exact peer restriction. */
  readonly peer?: RoutePeer;
};

/** Binding owner and destination. */
type RouteBinding = {
  /** Agent receiving matching messages. */
  readonly agentId: string;
  /** Fields restricting delivery to this binding. */
  readonly match?: RouteMatch;
};

/** Agent inventory available for route validation. */
type RouteAgentRoster = {
  /** Configured agent identities. */
  readonly entries?: Readonly<Record<string, Omit<RouteAgent, "id">>>;
  readonly list?: readonly RouteAgent[];
};

/** Read-only OpenClaw configuration surface required for route validation. */
export type RouteConfig = {
  /** Available route owners. */
  readonly agents?: RouteAgentRoster;
  /** Configured channel accounts. */
  readonly channels?: Readonly<Record<string, RouteChannel>>;
  /** Configured routing entries in SDK precedence order. */
  readonly bindings?: readonly RouteBinding[];
};

/** Project route inspection result without retaining the complete project state. */
export type ProjectRouteInspection = {
  /** Stable project identity and owner. */
  project: Pick<Project, "slug" | "name" | "agentId">;
  /** Inspected persisted destination. */
  endpoint: NotificationEndpoint;
  /** Reasons the exact route cannot be trusted. */
  diagnostics: RouteDiagnostic[];
};

/** One machine-readable route validation failure. */
export type RouteDiagnostic = {
  /** Stable code suitable for CLI and automation handling. */
  code: ValueOf<typeof ROUTE_DIAGNOSTIC_CODE>;
  /** Human-readable explanation including the invalid route component. */
  message: string;
};
