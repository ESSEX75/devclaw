/**
 * Tests for OpenClaw scope preflight.
 * Run with: npx tsx --test lib/application/setup/scopes.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import type { RunCommand } from "../../context.js";
import {
  ensureRequiredOpenClawScopes,
  ScopeApprovalRequiredError,
} from "./scopes.js";

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
