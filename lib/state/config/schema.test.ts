import assert from "node:assert";
import { describe, it } from "node:test";

import { validateConfig } from "./schema.js";

describe("workflow config schema", () => {
  it("accepts explicit completion result mappings", () => {
    assert.doesNotThrow(() => validateConfig({
      roles: {
        developer: {
          completion: {
            done: "COMPLETE",
            blocked: "BLOCKED",
          },
        },
      },
    }));
  });

  it("rejects the removed completion results array", () => {
    assert.throws(() => validateConfig({
      roles: {
        developer: {
          completionResults: ["done", "blocked"],
        },
      },
    }));
  });

  it("rejects completion mappings to unknown workflow events", () => {
    assert.throws(() => validateConfig({
      roles: {
        developer: {
          completion: {
            done: "UNKNOWN",
          },
        },
      },
    }));
  });
});
