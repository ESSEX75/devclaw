import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectOwner,
  getOwnerLabel,
  isOwnedByOrUnclaimed,
  OWNER_LABEL_PREFIX,
} from "../index.js";

describe("issue ownership labels", () => {
  it("builds and detects an instance owner label", () => {
    const label = getOwnerLabel("primary");

    assert.equal(label, `${OWNER_LABEL_PREFIX}primary`);
    assert.equal(detectOwner(["To Do", label]), "primary");
  });

  it("accepts unclaimed issues and rejects another instance's issues", () => {
    assert.equal(isOwnedByOrUnclaimed(["To Do"], "primary"), true);
    assert.equal(isOwnedByOrUnclaimed([getOwnerLabel("primary")], "primary"), true);
    assert.equal(isOwnedByOrUnclaimed([getOwnerLabel("secondary")], "primary"), false);
  });
});
