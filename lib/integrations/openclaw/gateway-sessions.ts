/** Reads gateway-owned session stores and preserves uncertainty in incomplete observations. */

import fs from "node:fs/promises";

import { z } from "zod";

import type { RunCommand } from "../../context.js";
import { GATEWAY_STATUS_METHOD, GATEWAY_STATUS_TIMEOUT_MS, SESSION_STORE_ENCODING } from "./const.js";
import type { GatewaySession, SessionLookup } from "./types.js";

/** Invalid optional metrics are unknown, never evidence of zero usage. */
const SessionMetricSchema = z.number().finite().nonnegative().optional().catch(undefined);

/** Minimal store metadata; unrelated SDK fields do not cross this boundary. */
const SessionEntrySchema = z.object({
  updatedAt: SessionMetricSchema,
  percentUsed: SessionMetricSchema,
  abortedLastRun: z.boolean().optional().catch(undefined),
  totalTokens: SessionMetricSchema,
  totalTokensFresh: z.boolean().optional().catch(undefined),
  contextTokens: SessionMetricSchema,
});

/** Gateway inventory locations and bounded observations still requiring record validation. */
const GatewayStatusSchema = z.object({
  sessions: z.object({
    paths: z.array(z.string().min(1)).optional(),
    recent: z.array(z.unknown()).optional(),
  }),
});

/** A recent observation includes its own session identity. */
const RecentSessionSchema = SessionEntrySchema.extend({ key: z.string().min(1) });

/** Store records are validated individually so malformed records do not hide other sessions. */
const SessionStoreSchema = z.record(z.string().min(1), z.unknown());

/** Normalize token usage against capacity without inventing missing metrics.
 * @param key - Exact session identity from the validated response or store key.
 * @param entry - Validated gateway metadata with optional metrics.
 */
function normalizeSession(key: string, entry: z.infer<typeof SessionEntrySchema>): GatewaySession {
  const totalTokens = entry.totalTokensFresh === false ? undefined : entry.totalTokens;
  const percentUsed = totalTokens !== undefined && entry.contextTokens !== undefined && entry.contextTokens > 0
    ? Math.round(totalTokens / entry.contextTokens * 100) : entry.percentUsed;

  return { key, updatedAt: entry.updatedAt ?? 0, percentUsed, abortedLastRun: entry.abortedLastRun,
    totalTokens, contextTokens: entry.contextTokens };
}

/** Keep the newest observation when the recent list and stores overlap.
 * @param lookup - Snapshot being assembled for one gateway status call.
 * @param session - Validated observation to merge.
 */
function mergeSession(lookup: SessionLookup, session: GatewaySession): void {
  const previous = lookup.sessions.get(session.key);

  if (!previous || session.updatedAt > previous.updatedAt) lookup.sessions.set(session.key, session);
}

/** Read all advertised stores and merge recent observations, retaining partial evidence on read failure.
 * A bounded recent list never proves absence. Transport failures return null; partial stores set complete=false.
 * @param gatewayTimeoutMs - Maximum wait for the gateway status command.
 * @param runCommand - Runtime-owned CLI transport.
 */
export async function fetchGatewaySessions(gatewayTimeoutMs = GATEWAY_STATUS_TIMEOUT_MS, runCommand: RunCommand): Promise<SessionLookup | null> {
  try {
    const result = await runCommand(["openclaw", "gateway", "call", GATEWAY_STATUS_METHOD, "--json"], { timeoutMs: gatewayTimeoutMs });

    if (result.code !== 0 || result.termination !== "exit" || result.killed || result.signal !== null) return null;
    const jsonStart = result.stdout.indexOf("{");
    const raw: unknown = JSON.parse(jsonStart >= 0 ? result.stdout.slice(jsonStart) : result.stdout);
    const data = GatewayStatusSchema.parse(raw);
    const paths = [...new Set(data.sessions.paths ?? [])];
    const lookup: SessionLookup = { sessions: new Map(), complete: paths.length > 0 };

    for (const rawSession of data.sessions.recent ?? []) {
      const session = RecentSessionSchema.safeParse(rawSession);

      if (session.success) mergeSession(lookup, normalizeSession(session.data.key, session.data));
    }

    for (const filePath of paths) {
      try {
        const rawStore: unknown = JSON.parse(await fs.readFile(filePath, SESSION_STORE_ENCODING));
        const store = SessionStoreSchema.parse(rawStore);

        for (const [key, rawEntry] of Object.entries(store)) {
          const entry = SessionEntrySchema.safeParse(rawEntry);

          if (entry.success) mergeSession(lookup, normalizeSession(key, entry.data));
          else lookup.complete = false;
        }
      } catch {
        lookup.complete = false;
      }
    }

    return lookup;
  } catch {
    return null;
  }
}

/** Report observed presence, proven absence, or unknown absence in incomplete/unavailable evidence.
 * Session presence alone never proves that a particular worker turn started.
 * @param sessionKey - Exact worker session to inspect.
 * @param lookup - Gateway evidence for this inspection, or null when unavailable.
 */
export function isSessionAlive(sessionKey: string, lookup: SessionLookup | null): boolean | null {
  if (!lookup) return null;
  if (lookup.sessions.has(sessionKey)) return true;

  return lookup.complete ? false : null;
}
