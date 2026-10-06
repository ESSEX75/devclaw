/** Tests transport evidence without contacting external channels. */

import assert from "node:assert/strict";
import { it } from "node:test";
import { deliverNotificationMessage } from "./delivery.js";
import type { MessageDeliveryInput } from "./types.js";

/** Exact route used by the transport-only fixtures. */
const input: MessageDeliveryInput = { target: "chat", accountId: "account", channel: "telegram", message: "text", config: {} };

it("reports known rejection when no send capability exists", async () => {
  const result = await deliverNotificationMessage(input);
  assert.equal(result.status, "rejected");
  assert.equal(result.delivered, false);
});

it("bounds an unresolved native send without invoking fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fallback = 0;
  const outcome = deliverNotificationMessage({ ...input,
    runtime: { outbound: { loadAdapter: async () => ({ sendText: () => new Promise(() => {}) }) } },
    runCommand: async () => { fallback++; throw new Error("must not run"); },
  });
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  assert.equal((await outcome).status, "unknown");
  assert.equal(fallback, 0);
});

it("preserves command timeout and thrown response loss as unknown", async () => {
  for (const runCommand of [
    async () => ({ stdout: "", stderr: "timeout", code: null, signal: null, killed: true, termination: "timeout" as const }),
    async () => { throw new Error("Response lost"); },
  ]) {
    const result = await deliverNotificationMessage({ ...input, runCommand });
    assert.equal(result.status, "unknown");
    assert.equal(result.delivered, false);
  }
});

it("passes the validated config snapshot and never falls back after a native send", async () => {
  let fallback = 0;
  const result = await deliverNotificationMessage({ ...input,
    runtime: { outbound: { loadAdapter: async () => ({ sendText: async (payload: { cfg: unknown }) => {
      assert.equal(payload.cfg, input.config);
      throw new Error("accepted then disconnected");
    } }) } },
    runCommand: async () => { fallback++; throw new Error("must not run"); },
  });
  assert.equal(result.status, "unknown");
  assert.equal(fallback, 0);
});

it("builds the exact account and thread command and reads its optional receipt", async () => {
  const result = await deliverNotificationMessage({ ...input, threadId: "topic",
    runCommand: async (argv, options) => {
      assert.deepEqual(argv, ["openclaw", "message", "send", "--channel", "telegram", "--target", "chat", "--message", "text", "--json", "--account", "account", "--thread-id", "topic"]);
      assert.equal(typeof options === "object" ? options.timeoutMs : options, 30_000);
      return { stdout: '{"messageId":"42"}', stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
    },
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.messageId, "42");
});
