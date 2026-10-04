/**
 * Tests for OpenClaw scope preflight.
 * Run with: npx tsx --test lib/application/setup/permissions/scopes.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import type { RunCommand } from "../../../context.js";
import { ensureRequiredOpenClawScopes } from "./scopes.js";
import { ScopeApprovalRequiredError, ScopeApprovalRejectedError } from "./errors.js";

/** Construct an isolated CLI transport outcome.
 * @param stdout - Serialized CLI response.
 * @param code - Process exit code.
 */
function commandResult(stdout: string, code = 0) {
  return {
    code,
    stdout,
    stderr: "",
    signal: null,
    killed: false,
    termination: "exit" as const,
  };
}

describe("ensureRequiredOpenClawScopes", () => {
  it("passes when required scopes are already approved", async () => {
    const calls: string[][] = [];
    const runCommand: RunCommand = async (argv) => {
      calls.push(argv);
      return commandResult(JSON.stringify({
        ok: true,
        status: "approved",
        approved: ["operator.read", "operator.write"],
        missing: [],
      }));
    };

    const result = await ensureRequiredOpenClawScopes(runCommand);

    assert.strictEqual(result.status, "approved");
    assert.deepStrictEqual(result.missing, []);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0]?.slice(0, 3), ["openclaw", "scopes", "check"]);
  });

  it("requests missing scopes and raises a deterministic pending approval error", async () => {
    const calls: string[][] = [];
    const runCommand: RunCommand = async (argv) => {
      calls.push(argv);
      if (argv[2] === "check") {
        return commandResult(JSON.stringify({
          ok: false,
          status: "missing_scopes",
          approved: ["operator.read"],
          missing: ["operator.write"],
        }));
      }
      return commandResult(JSON.stringify({
        ok: false,
        status: "pending_approval",
        requestId: "req_123",
        missing: ["operator.write"],
      }));
    };

    await assert.rejects(
      () => ensureRequiredOpenClawScopes(runCommand),
      (err: unknown) => {
        assert.ok(err instanceof ScopeApprovalRequiredError);
        assert.strictEqual(err.requestId, "req_123");
        assert.deepStrictEqual(err.missingScopes, ["operator.write"]);
        return true;
      },
    );
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[1]?.slice(0, 3), ["openclaw", "scopes", "request"]);
  });
});

for (const response of [
  { status: "denied", missing: [] },
  { status: "expired", ok: true },
]) {
  it(`rejects explicit ${response.status} despite success-like fields`, async () => {
    let calls = 0;
    await assert.rejects(ensureRequiredOpenClawScopes(async () => {
      calls++;
      return commandResult(JSON.stringify(response));
    }), ScopeApprovalRejectedError);
    assert.equal(calls, 1);
  });
}
it("does not suppress operational failures containing not found", async () => {
  await assert.rejects(ensureRequiredOpenClawScopes(async () => commandResult("Gateway credential not found", 1)), /credential not found/);
});
it("preserves optional preflight when the scopes command is absent", async () => {
  const result = await ensureRequiredOpenClawScopes(async () => commandResult("error: unknown command 'scopes'", 1));
  assert.equal(result.status, "unavailable");
});
it("rejects incomplete approval evidence and malformed responses", async () => {
  for (const response of ["not json", "{}", JSON.stringify({ status: "approved", approved: ["operator.read"], missing: [] }), JSON.stringify({ ok: true, missing: ["operator.write"] })]) {
    await assert.rejects(ensureRequiredOpenClawScopes(async () => commandResult(response)));
  }
});
it("rejects a denied request even when ok is true", async () => {
  let calls = 0;
  await assert.rejects(ensureRequiredOpenClawScopes(async () => commandResult(JSON.stringify(++calls === 1
    ? { status: "missing_scopes", missing: ["operator.write"] }
    : { status: "denied", ok: true }))), ScopeApprovalRejectedError);
  assert.equal(calls, 2);
});

it("combines check approval with a request that only confirms the missing permission", async () => {
  const calls: string[][] = [];
  const result = await ensureRequiredOpenClawScopes(async argv => {
    calls.push(argv);
    return commandResult(JSON.stringify(calls.length === 1
      ? { status: "missing_scopes", approved: ["operator.read"], missing: ["operator.write"] }
      : { status: "approved", approved: ["operator.write"], missing: [] }));
  });
  assert.deepStrictEqual(result.approved, ["operator.read", "operator.write"]);
  assert.deepStrictEqual(calls[1], ["openclaw", "scopes", "request", "--scope", "operator.write", "--reason", "devclaw-worker-dispatch", "--json"]);
});
it("does not create another request when check already identifies pending approval", async () => {
  let calls = 0;
  await assert.rejects(ensureRequiredOpenClawScopes(async () => {
    calls++;
    return commandResult(JSON.stringify({ status: "pending_approval", requestId: "existing", missing: ["operator.write"] }));
  }), ScopeApprovalRequiredError);
  assert.equal(calls, 1);
});
