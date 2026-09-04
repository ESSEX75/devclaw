/**
 * Tests for notify label helpers.
 *
 * Covers:
 * - getNotifyLabel / NOTIFY_LABEL_PREFIX / NOTIFY_LABEL_COLOR
 * - resolveNotifyBinding
 *
 * Run with: npx tsx --test lib/domain/notifications/routing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getNotifyLabel,
  NOTIFICATION_CHANNEL,
  NOTIFY_LABEL_PREFIX,
  NOTIFY_LABEL_COLOR,
  resolveNotifyBinding,
  type NotificationEndpoint,
} from "../index.js";

// ---------------------------------------------------------------------------
// getNotifyLabel / constants
// ---------------------------------------------------------------------------

describe("notify label helpers", () => {
  it("should build notify label from channel type and name", () => {
    assert.strictEqual(
      getNotifyLabel({ channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "primary" }),
      "notify:telegram:primary",
    );
    assert.strictEqual(
      getNotifyLabel({ channel: NOTIFICATION_CHANNEL.WHATSAPP, name: "dev-chat" }),
      "notify:whatsapp:dev-chat",
    );
  });

  it("NOTIFY_LABEL_PREFIX should be 'notify:'", () => {
    assert.strictEqual(NOTIFY_LABEL_PREFIX, "notify:");
  });

  it("NOTIFY_LABEL_COLOR should be light grey", () => {
    assert.strictEqual(NOTIFY_LABEL_COLOR, "#e4e4e4");
  });

  it("getNotifyLabel output should start with NOTIFY_LABEL_PREFIX", () => {
    const label = getNotifyLabel({ channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "primary" });
    assert.ok(label.startsWith(NOTIFY_LABEL_PREFIX));
  });
});

// ---------------------------------------------------------------------------
// resolveNotifyBinding — stable binding reference ({ channel, name })
// ---------------------------------------------------------------------------

describe("resolveNotifyBinding", () => {
  const channels: NotificationEndpoint[] = [
      { channelId: "-111", channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "primary" },
      { channelId: "-222", channel: NOTIFICATION_CHANNEL.WHATSAPP, name: "dev-chat" },
  ];

  it("should resolve channel by channel type and name", () => {
    const result = resolveNotifyBinding({ channel: NOTIFICATION_CHANNEL.WHATSAPP, name: "dev-chat" }, channels);
    assert.ok(result);
    assert.strictEqual(result.channelId, "-222");
    assert.strictEqual(result.channel, NOTIFICATION_CHANNEL.WHATSAPP);
  });

  it("does not silently redirect an unknown binding", () => {
    const result = resolveNotifyBinding({ channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "unknown" }, channels);
    assert.strictEqual(result, undefined);
  });

  it("uses the first endpoint only when no binding has been selected", () => {
    const result = resolveNotifyBinding(null, channels);
    assert.ok(result);
    assert.strictEqual(result.channelId, "-111");
  });

  it("should return undefined when channels is empty", () => {
    const result = resolveNotifyBinding({ channel: NOTIFICATION_CHANNEL.TELEGRAM, name: "primary" }, []);
    assert.strictEqual(result, undefined);
  });
});
