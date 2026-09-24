/**
 * Verifies that provider mutation errors produce safe durable retry policies.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ISSUE_CREATION_ERROR } from "../../../domain/index.js";
import { PROVIDER_OPERATION_ERROR, ProviderOperationError } from "../../../integrations/providers/index.js";
import { creationFailureFromProvider } from "./failure.js";

describe("creation provider failure mapping", () => {
  it("requires manual repair when the provider cannot confirm mutation outcome", () => {
    const failure = creationFailureFromProvider(new ProviderOperationError({
      code: PROVIDER_OPERATION_ERROR.TRANSIENT,
      message: "Response lost after submission",
      retryable: true,
      outcomeUnknown: true,
    }));

    assert.strictEqual(failure.code, ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN);
    assert.strictEqual(failure.retryable, false);
  });

  it("preserves the rate-limit retry time for a known rejected mutation", () => {
    const retryAfter = "2030-01-01T00:00:00.000Z";
    const failure = creationFailureFromProvider(new ProviderOperationError({
      code: PROVIDER_OPERATION_ERROR.RATE_LIMITED,
      message: "Request rejected before creation",
      retryable: true,
      outcomeUnknown: false,
      retryAfter,
    }));

    assert.strictEqual(failure.code, ISSUE_CREATION_ERROR.PROVIDER_RATE_LIMITED);
    assert.strictEqual(failure.retryAfter, retryAfter);
    assert.strictEqual(failure.retryable, true);
  });

  it("treats an unclassified error as an unknown provider outcome", () => {
    const failure = creationFailureFromProvider(new Error("Connection closed"));

    assert.strictEqual(failure.code, ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN);
    assert.strictEqual(failure.retryable, false);
  });
});
