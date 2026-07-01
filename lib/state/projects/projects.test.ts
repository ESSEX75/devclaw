/**
 * Tests for projects.ts — per-level worker state and accessors.
 * Run with: npx tsx --test lib/state/projects/projects.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  readProjects,
  getRoleWorker,
  emptyRoleWorkerState,
  emptySlot,
  findFreeSlot,
  findSlotByIssue,
  countActiveSlots,
  reconcileSlots,
  writeProjects,
  type ProjectsData,
  type RoleWorkerState,
} from "./index.js";

describe("readProjects", () => {
  it("should read current project-first per-level format correctly", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-proj-"));
    const dataDir = path.join(tmpDir, "devclaw");
    await fs.mkdir(dataDir, { recursive: true });

    const projectFirstData = {
      projects: {
        "g1": {
          slug: "test",
          name: "test",
          repo: "~/git/test",
          groupName: "Test",
          deployUrl: "",
          baseBranch: "main",
          deployBranch: "main",
          channels: [{ channelId: "g1", channel: "telegram", name: "primary", events: ["*"] }],
          workers: {
            developer: {
              levels: {
                medior: [
                  { active: true, issueId: "5", sessionKey: "key-1", startTime: "2026-01-01T00:00:00Z" },
                  { active: false, issueId: null, sessionKey: null, startTime: null },
                ],
              },
            },
          },
        },
      },
    };
    await fs.writeFile(path.join(dataDir, "projects.json"), JSON.stringify(projectFirstData), "utf-8");

    const data = await readProjects(tmpDir);
    const rw = data.projects["g1"].workers.developer;

    assert.ok(rw.levels.medior, "should have medior level");
    assert.strictEqual(rw.levels.medior.length, 2);
    assert.strictEqual(rw.levels.medior[0]!.active, true);
    assert.strictEqual(rw.levels.medior[0]!.issueId, "5");
    assert.strictEqual(rw.levels.medior[1]!.active, false);

    await fs.rm(tmpDir, { recursive: true });
  });

});

describe("per-level slot helpers", () => {
  it("findFreeSlot returns lowest inactive slot within a level", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: "1", sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
        ],
      },
    };
    assert.strictEqual(findFreeSlot(rw, "medior"), 1);
  });

  it("findFreeSlot returns null when all active in the level", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [{ active: true, issueId: "1", sessionKey: null, startTime: null }],
      },
    };
    assert.strictEqual(findFreeSlot(rw, "medior"), null);
  });

  it("findFreeSlot returns null for non-existent level", () => {
    const rw: RoleWorkerState = { levels: {} };
    assert.strictEqual(findFreeSlot(rw, "senior"), null);
  });

  it("findSlotByIssue returns correct level and index", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: "10", sessionKey: null, startTime: null },
        ],
        junior: [
          { active: true, issueId: "20", sessionKey: null, startTime: null },
        ],
      },
    };
    const result = findSlotByIssue(rw, "20");
    assert.deepStrictEqual(result, { level: "junior", slotIndex: 0 });
    assert.strictEqual(findSlotByIssue(rw, "99"), null);
  });

  it("countActiveSlots counts across all levels", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: "1", sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
        ],
        junior: [
          { active: true, issueId: "3", sessionKey: null, startTime: null },
        ],
      },
    };
    assert.strictEqual(countActiveSlots(rw), 2);
  });
});

describe("writeProjects round-trip", () => {
  it("should preserve per-level workers through write/read cycle", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-proj-"));
    const dataDir = path.join(tmpDir, "devclaw");
    await fs.mkdir(dataDir, { recursive: true });

    const data: ProjectsData = {
      projects: {
        "g1": {
          slug: "roundtrip",
          name: "roundtrip",
          repo: "~/git/rt",
          groupName: "RT",
          deployUrl: "",
          baseBranch: "main",
          deployBranch: "main",
          channels: [{ channelId: "g1", channel: "telegram", name: "primary", events: ["*"] }],
          workers: {
            developer: emptyRoleWorkerState({ medior: 2 }),
            tester: emptyRoleWorkerState({ medior: 1 }),
            architect: emptyRoleWorkerState({ senior: 1 }),
          },
        },
      },
    };

    await writeProjects(tmpDir, data);
    const loaded = await readProjects(tmpDir);
    const project = loaded.projects["g1"];

    assert.ok(project.workers.developer);
    assert.ok(project.workers.developer.levels.medior);
    assert.strictEqual(project.workers.developer.levels.medior.length, 2);
    assert.strictEqual(project.workers.developer.levels.medior[0]!.active, false);
    assert.strictEqual(project.workers.developer.levels.medior[1]!.active, false);

    await fs.rm(tmpDir, { recursive: true });
  });
});

describe("reconcileSlots", () => {
  it("should expand slots when config increases maxWorkers for a level", () => {
    const rw: RoleWorkerState = {
      levels: { medior: [emptySlot()] },
    };
    const changed = reconcileSlots(rw, { medior: 3 });
    assert.strictEqual(changed, true);
    assert.strictEqual(rw.levels.medior.length, 3);
    assert.strictEqual(rw.levels.medior[1]!.active, false);
    assert.strictEqual(rw.levels.medior[2]!.active, false);
  });

  it("should shrink idle slots when config decreases maxWorkers", () => {
    const rw: RoleWorkerState = {
      levels: { medior: [emptySlot(), emptySlot(), emptySlot()] },
    };
    const changed = reconcileSlots(rw, { medior: 1 });
    assert.strictEqual(changed, true);
    assert.strictEqual(rw.levels.medior.length, 1);
  });

  it("should not remove active slots when shrinking", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: "1", sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
          { active: true, issueId: "3", sessionKey: null, startTime: null },
        ],
      },
    };
    // Config says 1, but last slot (index 2) is active — shrinking stops immediately
    const changed = reconcileSlots(rw, { medior: 1 });
    assert.strictEqual(changed, false);
    assert.strictEqual(rw.levels.medior.length, 3);
  });

  it("should remove trailing idle slots but stop at active ones", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: "1", sessionKey: null, startTime: null },
          { active: true, issueId: "2", sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
        ],
      },
    };
    // Config says 1, last slot (index 2) is idle → removed, then slot 1 is active → stop
    const changed = reconcileSlots(rw, { medior: 1 });
    assert.strictEqual(changed, true);
    assert.strictEqual(rw.levels.medior.length, 2);
  });

  it("should not change when slots match config", () => {
    const rw: RoleWorkerState = {
      levels: { medior: [emptySlot(), emptySlot()] },
    };
    const changed = reconcileSlots(rw, { medior: 2 });
    assert.strictEqual(changed, false);
    assert.strictEqual(rw.levels.medior.length, 2);
  });

  it("should create new level arrays for levels in config but not in state", () => {
    const rw: RoleWorkerState = { levels: {} };
    const changed = reconcileSlots(rw, { medior: 2, senior: 1 });
    assert.strictEqual(changed, true);
    assert.strictEqual(rw.levels.medior.length, 2);
    assert.strictEqual(rw.levels.senior.length, 1);
  });
});
