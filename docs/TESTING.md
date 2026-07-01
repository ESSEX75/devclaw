# DevClaw — Testing Guide

DevClaw uses Node.js built-in test runner (`node:test`) with `node:assert/strict` for all tests.

## Quick Start

```bash
# Run all tests
npm test

# Run a specific test file
npx tsx --test lib/roles/registry.test.ts

# Run focused issue state/projection tests
npm run test:issue-state

# Run lightweight architecture diagnostics
npm run arch:check

# Run E2E tests only
npx tsx --test lib/application/pipeline/*.e2e.test.ts

# Build (also type-checks all test files)
npm run build
```

`node:test` via `tsx --test` is the canonical test runner for this repository.
`npm test` discovers TypeScript test files that import `node:test` and runs
them with `tsx --test`. Vitest is not the project runner for current canonical
tests.

`npm run arch:check` runs in warn-only mode so known refactor targets such as
existing import cycles are visible without blocking this first safety-rail step.
Use `npm run arch:check:strict` when a refactor step is ready to enforce a clean
architecture report.

### Current Known Failures

`npm test` currently exposes pre-existing source-test failures that are outside
the first architecture guard step:

- `lib/tools/worker/work-finish.test.ts` writes `devclaw/log/audit.log` without
  first creating the `devclaw/log/` directory in several cases.
- Bootstrap tests still expect empty instructions when workspace prompt files are
  missing, while current runtime falls back to packaged role defaults.
- Several pipeline E2E assertions are out of sync with current session reuse and
  review-policy behavior.
- A few legacy tests still use Vitest-style imports and are intentionally not
  selected by the canonical `node:test` runner.

## Test Files

### Unit Tests

| File | What it tests |
|---|---|
| [lib/roles/registry.test.ts](../lib/roles/registry.test.ts) | Role registry: role lookup, level resolution, model defaults |
| [lib/state/projects/projects.test.ts](../lib/state/projects/projects.test.ts) | Project state: read/write, worker state, atomic file operations |
| [lib/integrations/openclaw/bootstrap-hook.test.ts](../lib/integrations/openclaw/bootstrap-hook.test.ts) | Bootstrap hook: role instruction loading, source tracking, overloads |
| [lib/application/tasks/attachments.test.ts](../lib/application/tasks/attachments.test.ts) | File attachment handling |
| [lib/tools/tasks/task-set-level.test.ts](../lib/tools/tasks/task-set-level.test.ts) | Task set level tool: level hints, label detection |
| [lib/tools/tasks/task-edit-body.test.ts](../lib/tools/tasks/task-edit-body.test.ts) | Task edit body tool: title/body editing, state guards |
| [lib/tools/tasks/research-task.test.ts](../lib/tools/tasks/research-task.test.ts) | Research task tool: architect dispatch |
| [lib/tools/admin/queue-status.test.ts](../lib/tools/admin/queue-status.test.ts) | Queue status formatting |
| [lib/tools/worker/group-isolation.test.ts](../lib/tools/worker/group-isolation.test.ts) | Worker group isolation |
| [lib/application/heartbeat/health.test.ts](../lib/application/heartbeat/health.test.ts) | Heartbeat health pass: zombie detection, stale workers |
| [lib/integrations/providers/provider-pr-status.test.ts](../lib/integrations/providers/provider-pr-status.test.ts) | PR status polling and detection |
| [lib/state/setup/version.test.ts](../lib/state/setup/version.test.ts) | Version tracking and comparison |
| [lib/state/setup/workspace-files.test.ts](../lib/state/setup/workspace-files.test.ts) | Workspace initialization and write-once defaults |
| [lib/names.test.ts](../lib/names.test.ts) | Deterministic name generation |
| [lib/instance.test.ts](../lib/instance.test.ts) | Instance name management |

### E2E Tests

| File | What it tests |
|---|---|
| [lib/application/pipeline/pipeline.e2e.test.ts](../lib/application/pipeline/pipeline.e2e.test.ts) | Full pipeline: completion rules, label transitions, actions |
| [lib/application/pipeline/bootstrap.e2e.test.ts](../lib/application/pipeline/bootstrap.e2e.test.ts) | Bootstrap hook chain: session key → parse → load instructions → inject |

## Test Infrastructure

### Test Harness (`lib/testing/`)

The [`lib/testing/`](../lib/testing/) module provides E2E test infrastructure:

```typescript
import { createTestHarness } from "../testing/index.js";

const h = await createTestHarness({
  projectName: "my-project",
  channelId: "-1234567890",
  workflow: DEFAULT_WORKFLOW,
  workers: {
    developer: { active: true, issueId: "42", level: "medior" },
  },
});
try {
  // ... run tests against h.provider, h.commands, etc.
} finally {
  await h.cleanup();
}
```

**`createTestHarness()`** scaffolds:
- Temporary workspace directory with `devclaw/` data dir and `log/` subdirectory
- `projects.json` with test project and configurable worker state
- Mock `runCommand` via `CommandInterceptor` (captures all CLI calls)
- `TestProvider` — in-memory `IssueProvider` with call tracking

### TestProvider

In-memory implementation of `IssueProvider` for testing. Tracks all provider method calls and maintains in-memory issue state:

```typescript
const h = await createTestHarness();
h.provider.seedIssue(42, {
  title: "Fix the bug",
  labels: ["Doing"],
  state: "open",
});

// After running pipeline code:
const calls = h.provider.calls;  // All method invocations
```

### CommandInterceptor

Captures all `runCommand` calls during tests. Provides filtering and extraction helpers:

```typescript
// All captured commands
h.commands.commands;

// Filter by command name
h.commands.commandsFor("openclaw");

// Extract task messages dispatched to workers
h.commands.taskMessages();

// Extract session creation patches
h.commands.sessionPatches();

// Reset between test cases
h.commands.reset();
```

### simulateBootstrap

Tests the full bootstrap hook chain without a live OpenClaw gateway:

```typescript
// Write a project-specific prompt
await h.writePrompt("developer", "Custom dev instructions", "my-project");

// Simulate bootstrap for a developer session
const files = await h.simulateBootstrap(
  "agent:orchestrator:subagent:my-project-developer-medior"
);

// Verify injected bootstrap files
assert.strictEqual(files.length, 1);
assert.strictEqual(files[0].content, "Custom dev instructions");
```

## Writing Tests

### Pattern: Unit Test

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("my feature", () => {
  it("should do something", () => {
    const result = myFunction("input");
    assert.strictEqual(result, "expected");
  });
});
```

### Pattern: E2E Pipeline Test

```typescript
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness, type TestHarness } from "../testing/index.js";
import { executeCompletion } from "./pipeline.js";

describe("pipeline completion", () => {
  let h: TestHarness;

  afterEach(async () => {
    if (h) await h.cleanup();
  });

  it("developer:done transitions Doing → To Review", async () => {
    h = await createTestHarness({
      workers: {
        developer: { active: true, issueId: "42", level: "medior" },
      },
    });
    h.provider.seedIssue(42, { labels: ["Doing"], state: "open" });

    const result = await executeCompletion({
      workspaceDir: h.workspaceDir,
      projectSlug: h.project.slug,
      role: "developer",
      result: "done",
      issueId: 42,
      provider: h.provider,
      repoPath: h.project.repo,
      projectName: h.project.name,
      channels: h.project.channels,
      workflow: h.workflow,
    });

    assert.strictEqual(result.rule.to, "To Review");
  });
});
```

### Pattern: Bootstrap Hook Test

```typescript
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness, type TestHarness } from "../testing/index.js";

describe("bootstrap instructions", () => {
  let h: TestHarness;

  afterEach(async () => {
    if (h) await h.cleanup();
  });

  it("injects project-specific prompt for developer", async () => {
    h = await createTestHarness({ projectName: "webapp" });
    await h.writePrompt("developer", "Build with React", "webapp");

    const files = await h.simulateBootstrap(
      "agent:orchestrator:subagent:webapp-developer-medior"
    );

    assert.strictEqual(files.length, 1);
    assert.ok(files[0].content?.includes("React"));
  });
});
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - run: npx tsx --test lib/**/*.test.ts
```

### GitLab CI

```yaml
test:
  image: node:20
  script:
    - npm ci
    - npm run build
    - npx tsx --test lib/**/*.test.ts
```

## Debugging Tests

### Run specific test

```bash
# Run by file
npx tsx --test lib/roles/registry.test.ts

# Run by name pattern
npx tsx --test --test-name-pattern "should have all expected roles" lib/**/*.test.ts
```

### Debug with Node inspector

```bash
node --inspect-brk node_modules/.bin/tsx --test lib/roles/registry.test.ts
```

Then open Chrome DevTools at `chrome://inspect`.

## Best Practices

- **Use `node:test` + `node:assert/strict`** — no test framework dependencies
- **Use `createTestHarness()`** for any test that needs workspace state, providers, or command interception
- **Always call `h.cleanup()`** in `afterEach` to remove temp directories
- **Seed provider state** with `h.provider.seedIssue()` before testing pipeline operations
- **Use `h.commands`** to verify what CLI commands were dispatched without actually running them
- **One assertion focus per test** — test one behavior, not the whole pipeline
- **Test error cases** — invalid roles, missing projects, bad state transitions
