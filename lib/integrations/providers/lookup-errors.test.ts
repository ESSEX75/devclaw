/** Tests the typed provider lookup boundary used by destructive lifecycle decisions. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyProviderLookupFailure,
  isProviderIssueLookupError,
  PROVIDER_ISSUE_LOOKUP_ERROR,
  ProviderIssueLookupError,
} from "./lookup-errors.js";

describe("provider issue lookup errors", () => {
  it("does not classify arbitrary 404 text as a confirmed missing issue", () => {
    const error = classifyProviderLookupFailure("github", new Error("documentation mentions 404"));
    assert.equal(error.code, PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN);
  });

  it("preserves authorization and retry semantics as typed codes", () => {
    const unauthorized = classifyProviderLookupFailure("gitlab", new Error("401 Unauthorized"));
    const rateLimited = classifyProviderLookupFailure("github", new Error("429 rate limit"));
    assert.equal(unauthorized.code, PROVIDER_ISSUE_LOOKUP_ERROR.UNAUTHORIZED);
    assert.equal(unauthorized.retryable, false);
    assert.equal(rateLimited.code, PROVIDER_ISSUE_LOOKUP_ERROR.RATE_LIMITED);
    assert.equal(rateLimited.retryable, true);
  });

  it("recognizes only the explicit typed error contract in application code", () => {
    assert.equal(isProviderIssueLookupError(new Error("404 not found")), false);
    assert.equal(isProviderIssueLookupError(new ProviderIssueLookupError({
      code: PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND,
      provider: "github",
      retryable: false,
      message: "confirmed",
    })), true);
  });
});
