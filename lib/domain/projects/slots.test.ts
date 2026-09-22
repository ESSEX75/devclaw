/**
 * Verifies reconciliation of configured worker-slot levels.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptySlot, reconcileSlots, type RoleWorkerState } from "./index.js";

describe("reconcileSlots", () => {
  it("removes an unconfigured level when all of its slots are inactive", () => {
    const roleWorker: RoleWorkerState = {
      levels: { legacy: [emptySlot()] },
    };

    assert.equal(reconcileSlots(roleWorker, {}), true);
    assert.deepEqual(roleWorker.levels, {});
  });

  it("retains an unconfigured level while it has an active slot", () => {
    const activeSlot = emptySlot();
    activeSlot.active = true;
    activeSlot.issueId = 42;
    const roleWorker: RoleWorkerState = {
      levels: { legacy: [activeSlot] },
    };

    assert.equal(reconcileSlots(roleWorker, {}), false);
    assert.deepEqual(roleWorker.levels, { legacy: [activeSlot] });
  });

  it("removes a retained level after its active work finishes", () => {
    const activeSlot = emptySlot();
    activeSlot.active = true;
    const roleWorker: RoleWorkerState = {
      levels: { legacy: [activeSlot] },
    };

    reconcileSlots(roleWorker, {});
    activeSlot.active = false;

    assert.equal(reconcileSlots(roleWorker, {}), true);
    assert.deepEqual(roleWorker.levels, {});
  });
});
