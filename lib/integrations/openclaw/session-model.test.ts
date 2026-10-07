/** Verifies persisted session model confirmation and rejection of failed or unrelated RPC responses. */

import assert from "node:assert/strict";
import { it } from "node:test";

import type { RunCommand } from "../../context.js";
import { ensureSessionModel } from "./session-model.js";

/** Deterministic worker session used to verify acknowledgement identity. */
const SESSION_KEY = "agent:dev:subagent:project-developer-senior-bot";

/** Valid gateway acknowledgement after model alias resolution and persistence. */
const CONFIRMATION = {
  ok: true,
  key: SESSION_KEY,
  resolved: { modelProvider: "anthropic", model: "claude-opus-4-6" },
};

it("requires JSON confirmation and lets the gateway resolve model aliases", async () => {
  const runCommand: RunCommand = async (args, options) => {
    assert.ok(args.includes("--json"));
    assert.equal(args[3], "sessions.patch");
    assert.deepEqual(options, { timeoutMs: 1234 });
    assert.deepEqual(JSON.parse(args[5]), { key: SESSION_KEY, model: "opus", label: "Worker" });

    return { stdout: `[plugins] registered\n${JSON.stringify(CONFIRMATION)}`, stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
  };

  await ensureSessionModel(SESSION_KEY, "opus", runCommand, 1234, "Worker");
});

it("accepts canonical case folding of worker session keys", async () => {
  const runCommand: RunCommand = async () => ({
    stdout: JSON.stringify(CONFIRMATION), stderr: "", code: 0, signal: null, killed: false, termination: "exit",
  });

  await ensureSessionModel(SESSION_KEY.toUpperCase(), "opus", runCommand, 1234);
});

it("rejects malformed, incomplete, failed, or unrelated confirmations", async () => {
  for (const response of [
    "", "invalid JSON", "{", "{}", "null", "[]",
    JSON.stringify({ ...CONFIRMATION, ok: false }),
    JSON.stringify({ ...CONFIRMATION, key: `${SESSION_KEY}-other` }),
    JSON.stringify({ ...CONFIRMATION, resolved: { modelProvider: "anthropic", model: "" } }),
  ]) {
    const runCommand: RunCommand = async () => ({ stdout: response, stderr: "", code: 0, signal: null, killed: false, termination: "exit" });

    await assert.rejects(ensureSessionModel(SESSION_KEY, "opus", runCommand, 1234), /Session model setup failed/);
  }
});

it("rejects nonzero command exits and transport errors even if output looks valid", async () => {
  const failedExit: RunCommand = async () => ({
    stdout: JSON.stringify(CONFIRMATION), stderr: "patch denied", code: 1, signal: null, killed: false, termination: "exit",
  });
  const failedTransport: RunCommand = async () => { throw new Error("timeout"); };
  const killedCommand: RunCommand = async () => ({
    stdout: JSON.stringify(CONFIRMATION), stderr: "", code: 0, signal: null, killed: true, termination: "exit",
  });

  await assert.rejects(ensureSessionModel(SESSION_KEY, "opus", failedExit, 1234), /patch denied/);
  await assert.rejects(ensureSessionModel(SESSION_KEY, "opus", failedTransport, 1234), /timeout/);
  await assert.rejects(ensureSessionModel(SESSION_KEY, "opus", killedCommand, 1234), /Gateway model patch failed/);
});
