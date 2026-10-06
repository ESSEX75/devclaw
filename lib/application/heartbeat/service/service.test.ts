/** Verifies timer cancellation and the single in-flight heartbeat lifecycle. */

import assert from "node:assert/strict";
import { it } from "node:test";

import { createTestHarness } from "../../../testing/index.js";
import { resolveHeartbeatConfig } from "./config.js";
import { createHeartbeatLifecycle } from "./service.js";

it("rejects timer intervals that Node would roll over into a rapid loop", () => {
  assert.equal(resolveHeartbeatConfig({ work_heartbeat: { intervalSeconds: 3_000_000 } }).intervalSeconds, 60);
});

it("does not overlap ticks, waits for a running tick on stop, and restarts one timer", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const harness = await createTestHarness();
  const messages: string[] = [];
  const context = { config: {}, logger: {
    info(message: string) { messages.push(message); }, warn(message: string) { messages.push(message); },
    error(message: string) { messages.push(message); },
  } };
  let running = 0;
  let maximum = 0;
  let starts = 0;
  let release = () => {};
  const lifecycle = createHeartbeatLifecycle({ config: {}, runCommand: harness.runCommand,
    pluginConfig: { work_heartbeat: { intervalSeconds: 1 } } }, async () => {
    starts++;
    running++;
    maximum = Math.max(maximum, running);
    await new Promise<void>(resolve => { release = resolve; });
    running--;
  });

  try {
    await lifecycle.start(context);
    t.mock.timers.tick(2_000);
    assert.equal(starts, 1);
    t.mock.timers.tick(5_000);
    assert.equal(starts, 1);
    const stopped = lifecycle.stop(context);

    release();
    await stopped;
    t.mock.timers.tick(5_000);
    assert.equal(starts, 1);
    await lifecycle.start(context);
    t.mock.timers.tick(2_000);
    assert.equal(starts, 2);
    release();
    await lifecycle.stop(context);
    assert.equal(maximum, 1);
  } finally { release(); await harness.cleanup(); }
});

it("does not restart timers when stop overtakes a start waiting for the running tick", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const harness = await createTestHarness();
  let release = () => {};
  let ticks = 0;
  const context = { config: {}, logger: { info() {}, warn() {}, error() {} } };
  const lifecycle = createHeartbeatLifecycle({ config: {}, runCommand: harness.runCommand,
    pluginConfig: { work_heartbeat: { intervalSeconds: 1 } } }, async () => {
    ticks++;
    await new Promise<void>(resolve => { release = resolve; });
  });

  try {
    await lifecycle.start(context);
    t.mock.timers.tick(2_000);
    const restarting = lifecycle.start(context);
    const stopping = lifecycle.stop(context);

    release();
    await Promise.all([restarting, stopping]);
    t.mock.timers.tick(5_000);
    assert.equal(ticks, 1);
  } finally { release(); await harness.cleanup(); }
});
