/**
 * types.ts — Shared types for OpenClaw config and generic objects.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";

export type OpenClawAgent = NonNullable<
  NonNullable<OpenClawConfig["agents"]>["list"]
>[0];

export type OpenClawChannelBinding = NonNullable<OpenClawConfig["bindings"]>[0];
