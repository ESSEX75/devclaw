# DevClaw — Configuration Reference

DevClaw uses a three-layer configuration system. All role, workflow, and timeout settings live in `workflow.yaml` files — not in `openclaw.json`.

## Three-Layer Config Resolution

```
Layer 1: Built-in defaults (ROLE_REGISTRY + DEFAULT_WORKFLOW)
Layer 2: Workspace:  <workspace>/devclaw/workflow.yaml
Layer 3: Project:    <workspace>/devclaw/projects/<project>/workflow.yaml
```

Each layer can partially override the one below it. Only the fields you specify are merged — everything else inherits from the layer below.

**Source:** [`lib/state/config/loader.ts`](../lib/state/config/loader.ts)

**Validation:** Config is validated at load time with Zod schemas ([`lib/state/config/schema.ts`](../lib/state/config/schema.ts)). Integrity checks verify transition targets exist, queue states have roles, and terminal states have no outgoing transitions.

---

## Workflow Config (`workflow.yaml`)

The `workflow.yaml` file configures roles, workflow states, and timeouts. Place it at `<workspace>/devclaw/workflow.yaml` for workspace-wide settings, or at `<workspace>/devclaw/projects/<project>/workflow.yaml` for project-specific overrides.

### Role Configuration

Override which LLM model powers each level, customize levels, tune per-level concurrency, or disable roles entirely:

```yaml
roles:
  developer:
    models:
      junior: anthropic/claude-haiku-4-5
      medior: anthropic/claude-sonnet-4-5
      senior:
        model: anthropic/claude-opus-4-6
        maxWorkers: 1
  tester:
    models:
      junior: anthropic/claude-haiku-4-5
      medior: anthropic/claude-sonnet-4-5
      senior: anthropic/claude-opus-4-6
  architect:
    models:
      junior: anthropic/claude-sonnet-4-5
      senior: anthropic/claude-opus-4-6
  # Disable a role entirely:
  # architect: false
```

**Role override fields** (all optional — only override what you need):

| Field | Type | Description |
|---|---|---|
| `levels` | string[] | Available levels for this role |
| `defaultLevel` | string | Default level when not specified |
| `models` | Record<string, string \| object> | Model ID per level, or `{ model, maxWorkers }` for per-level concurrency |
| `emoji` | Record<string, string> | Emoji per level for announcements |
| `completionResults` | string[] | Valid completion results |

Per-level worker capacity is resolved from `roles.<role>.models.<level>.maxWorkers`, then `workflow.maxWorkersPerLevel`, then the built-in default.

**Default models:**

| Role | Level | Default Model |
|---|---|---|
| developer | junior | `anthropic/claude-haiku-4-5` |
| developer | medior | `anthropic/claude-sonnet-4-5` |
| developer | senior | `anthropic/claude-opus-4-6` |
| tester | junior | `anthropic/claude-haiku-4-5` |
| tester | medior | `anthropic/claude-sonnet-4-5` |
| tester | senior | `anthropic/claude-opus-4-6` |
| architect | junior | `anthropic/claude-sonnet-4-5` |
| architect | senior | `anthropic/claude-opus-4-6` |
| reviewer | junior | `anthropic/claude-haiku-4-5` |
| reviewer | senior | `anthropic/claude-sonnet-4-5` |

**Source:** [`lib/roles/registry.ts`](../lib/roles/registry.ts)

**Model resolution order:**

1. Project `workflow.yaml` → `roles.<role>.models.<level>`
2. Workspace `workflow.yaml` → `roles.<role>.models.<level>`
3. Built-in defaults from `ROLE_REGISTRY`
4. Passthrough — treat the level string as a raw model ID

### Workflow States

The workflow section defines the state machine for issue lifecycle — states, transitions, review policy, and the optional test phase.

The default workflow also sets:

```yaml
workflow:
  maxWorkersPerLevel: 2
  roleExecution: parallel
```

`maxWorkersPerLevel` creates that many slots for each level of each enabled role. With the default developer levels (`junior`, `medior`, `senior`) and `maxWorkersPerLevel: 2`, a project can have up to six developer slots, subject to queue state and `roleExecution`.

See **[Workflow Reference](WORKFLOW.md)** for the full state machine documentation, including state types, built-in actions, review policy options, and how to enable the test phase.

### Timeouts

```yaml
timeouts:
  gitPullMs: 30000
  gatewayMs: 15000
  sessionPatchMs: 30000
  dispatchMs: 600000
  staleWorkerHours: 2
```

| Setting | Default | Description |
|---|---|---|
| `gitPullMs` | 30000 | Timeout for git pull operations (ms) |
| `gatewayMs` | 15000 | Timeout for gateway RPC calls (ms) |
| `sessionPatchMs` | 30000 | Timeout for session creation (ms) |
| `dispatchMs` | 600000 | Timeout for task dispatch (ms) |
| `staleWorkerHours` | 2 | Hours before a worker is considered stale |
| `sessionContextBudget` | 0.6 | Clear and recreate a worker session when it exceeds this fraction of the context window |
| `stallTimeoutMinutes` | 15 | Minutes of session inactivity before stall detection/nudging starts |

---

## Plugin Configuration (`openclaw.json`)

Some settings still live in `openclaw.json` under `plugins.entries.devclaw.config`:

### Project Execution Mode

Controls cross-project parallelism:

```json
{
  "plugins": {
    "entries": {
      "devclaw": {
        "config": {
          "projectExecution": "parallel"
        }
      }
    }
  }
}
```

| Value | Behavior |
|---|---|
| `"parallel"` (default) | Multiple projects can have active workers simultaneously |
| `"sequential"` | Only one project's workers active at a time. Useful for single-agent deployments. |

### Heartbeat Service

Token-free interval-based health checks + queue dispatch:

```json
{
  "plugins": {
    "entries": {
      "devclaw": {
        "config": {
          "work_heartbeat": {
            "enabled": true,
            "intervalSeconds": 60,
            "maxPickupsPerTick": 4
          }
        }
      }
    }
  }
}
```

| Setting | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable the heartbeat service |
| `intervalSeconds` | number | `60` | Seconds between ticks |
| `maxPickupsPerTick` | number | `4` | Maximum worker dispatches per tick (budget control) |

**Source:** [`lib/services/heartbeat/index.ts`](../lib/services/heartbeat/index.ts)

The heartbeat service runs as a plugin service tied to the gateway lifecycle. Every tick: health pass (auto-fix zombies, stale workers) → review pass (poll PR status for "To Review" issues) → tick pass (fill free slots by priority). Zero LLM tokens consumed.

### Notifications

Control which lifecycle events send notifications:

```json
{
  "plugins": {
    "entries": {
      "devclaw": {
        "config": {
          "notifications": {
            "workerStart": true,
            "workerComplete": true
          }
        }
      }
    }
  }
}
```

| Setting | Default | Description |
|---|---|---|
| `workerStart` | `true` | Announce when a worker picks up a task |
| `workerComplete` | `true` | Announce when a worker finishes a task |

### Telegram Link Previews

By default Telegram shows a link preview card for the first URL in each message. This clutters DevClaw notifications with GitHub/GitLab issue cards. Disable it globally with a single config line:

```json
{
  "channels": {
    "telegram": {
      "linkPreview": false
    }
  }
}
```

Setting `linkPreview: false` on the Telegram channel config causes OpenClaw to pass `link_preview_options: { is_disabled: true }` to the Telegram Bot API on every send. This is a **gateway-level global setting** — it applies to all messages, not just DevClaw notifications.

> **Recommended for all DevClaw deployments.** DevClaw already uses inline markdown links (`[text](url)`) for cleaner output, and link preview cards add no value in a CI/CD notification context.

### Agent Tool Permissions

Restrict DevClaw tools to your orchestrator agent. Setup writes these tools to `tools.alsoAllow`, preserves existing `alsoAllow` entries, and denies direct session-control tools because the plugin owns worker session lifecycle:

```json
{
  "agents": {
    "list": [
      {
        "id": "my-orchestrator",
        "tools": {
          "alsoAllow": [
            "task_start",
            "work_finish",
            "task_create",
            "task_set_level",
            "task_comment",
            "task_edit_body",
            "task_attach",
            "task_owner",
            "tasks_status",
            "task_list",
            "project_status",
            "health",
            "project_register",
            "sync_labels",
            "channel_link",
            "channel_unlink",
            "channel_list",
            "setup",
            "onboard",
            "autoconfigure_models",
            "research_task",
            "workflow_guide",
            "config"
          ],
          "deny": [
            "sessions_spawn",
            "sessions_send"
          ]
        }
      }
    ]
  }
}
```

---

## Project State (`projects.json` and `issues.json`)

Project registration and worker-slot state live in `<workspace>/devclaw/projects.json`, keyed by project slug. Initialized DevClaw-managed issue runtime state lives per project in `<workspace>/devclaw/projects/<project>/issues.json`.

**Source:** [`lib/domain/projects/types.ts`](../lib/domain/projects/types.ts), [`lib/domain/projects/slots.ts`](../lib/domain/projects/slots.ts), [`lib/domain/issues/types.ts`](../lib/domain/issues/types.ts), [`lib/state/issues/store.ts`](../lib/state/issues/store.ts)

### Schema

```json
{
  "projects": {
    "my-webapp": {
      "slug": "my-webapp",
      "name": "my-webapp",
      "repo": "~/git/my-webapp",
      "repoRemote": "git@github.com:org/my-webapp.git",
      "groupName": "Dev - My Webapp",
      "baseBranch": "development",
      "deployBranch": "development",
      "deployUrl": "https://my-webapp.example.com",
      "provider": "github",
      "channels": [
        {
          "channelId": "-1001234567890",
          "channel": "telegram",
          "name": "primary",
          "events": ["*"],
          "accountId": "dev",
          "threadId": "331"
        }
      ],
      "workers": {
        "developer": {
          "levels": {
            "junior": [
              {
                "active": false,
                "issueId": null,
                "sessionKey": null,
                "startTime": null
              }
            ],
            "medior": [
              {
                "active": true,
                "issueId": "42",
                "sessionKey": "agent:orchestrator:subagent:my-webapp-developer-medior-0",
                "startTime": "2026-06-01T12:00:00.000Z",
                "previousLabel": "To Do",
                "name": "Ada"
              }
            ],
            "senior": []
          }
        },
        "tester": {
          "levels": {
            "junior": [],
            "medior": [],
            "senior": []
          }
        }
      }
    }
  }
}
```

### Project fields

| Field | Type | Description |
|---|---|---|
| `slug` | string | Stable project key used in tool calls |
| `name` | string | Short project name |
| `repo` | string | Path to git repo (supports `~/` expansion) |
| `repoRemote` | string | Optional detected git remote URL |
| `groupName` | string | Group display name |
| `baseBranch` | string | Base branch for development |
| `deployBranch` | string | Branch that triggers deployment |
| `deployUrl` | string | Deployment URL |
| `channels` | Channel[] | Messaging endpoints linked to this project |
| `provider` | `"github"` \| `"gitlab"` | Issue tracker provider (auto-detected, stored for reuse) |

`roleExecution` is resolved from `workflow.yaml` rather than stored on the project record.

### Channel fields

Each project can have multiple linked channels:

| Field | Type | Description |
|---|---|---|
| `channelId` | string | Chat/group/channel ID |
| `channel` | `"telegram"` \| `"whatsapp"` \| `"discord"` \| `"slack"` | Messaging provider |
| `name` | string | Human-readable endpoint name (`primary`, `dev-chat`, etc.) |
| `events` | string[] | Event filters. `["*"]` receives all project notifications |
| `accountId` | string | Optional OpenClaw channel account ID |
| `threadId` | string | Optional thread/topic ID for forum-style channels |

### Worker state fields

Each role in the `workers` record has a `RoleWorkerState` object. It is grouped by level, and each level contains an array of slots:

| Field | Type | Description |
|---|---|---|
| `levels` | Record<string, SlotState[]> | Slots grouped by level (`junior`, `medior`, `senior`, etc.) |

Each slot has:

| Field | Type | Description |
|---|---|---|
| `active` | boolean | Whether this slot is running a task |
| `issueId` | string \| null | Issue being worked on |
| `sessionKey` | string \| null | Reusable OpenClaw session key for this slot |
| `startTime` | string \| null | ISO timestamp when the slot became active |
| `previousLabel` | string \| null | Queue label to restore if the worker is healed/requeued |
| `name` | string | Optional deterministic display name for this slot |
| `lastIssueId` | string \| null | Previous issue preserved after deactivation for feedback-cycle detection |

### Key design decisions

- **Project-first state** — projects are keyed by slug and can be linked to multiple channels.
- **Issue-local runtime authority** — initialized managed issues use `devclaw/projects/<project>/issues.json` for `workflowState`, `workflowLabel`, role/level assignment, review/test policy, and projection integrity.
- **Provider labels are projection** — GitHub/GitLab labels remain required for visual parity and filtering, but they are not runtime truth for initialized managed issues. Manual label edits do not mutate local state.
- **Projection guard** — heartbeat compares provider labels and metadata with local state. Recoverable label drift is repaired. Missing or tampered managed metadata sets `integrity_error` until repaired from local state.
- **Backfill boundary** — old issues without a local `issues.json` entry are treated as `projection_uninitialized` and must be explicitly initialized/backfilled before managed dispatch.
- **Queue-first task creation** — ordinary `task_create` calls create a managed issue directly in the first developer queue state, normally `To Do`; `Planning` remains a hold state for explicit refinement/research flows.
- **Inline issue archive** — `devclaw issues cleanup` archives old closed local issue records into `archive.issues` inside `issues.json`; `issues.archive.jsonl` is not part of the MVP.
- **Per-level slots** — each level owns an array of slots. Capacity is configured through `workflow.maxWorkersPerLevel` and per-model `maxWorkers`.
- **Session-per-slot** — each slot preserves its own session key, accumulating context independently. Level selection plus slot index maps directly to a session key.
- **Sessions preserved on completion** — when a worker completes a task, `sessionKey` is preserved while `active`, `issueId`, `startTime`, and `previousLabel` are cleared. This enables session reuse.
- **Atomic writes** — all writes go through temp-file-then-rename to prevent corruption. File locking prevents concurrent read-modify-write races.
- **Sessions persist indefinitely** — no auto-cleanup. The `health` tool handles manual cleanup.
- **Dynamic workers** — the `workers` record is keyed by role ID (e.g., `developer`, `tester`, `architect`). New roles are created automatically when dispatched.

---

## Workspace File Layout

```
<workspace>/
├── devclaw/
│   ├── projects.json              ← Project state (auto-managed)
│   ├── workflow.yaml              ← Workspace-level config overrides
│   ├── prompts/
│   │   ├── developer.md           ← Default developer instructions
│   │   ├── tester.md              ← Default tester instructions
│   │   └── architect.md           ← Default architect instructions
│   ├── projects/
│   │   ├── my-webapp/
│   │   │   ├── workflow.yaml      ← Project-specific config overrides
│   │   │   ├── issues.json        ← Project-local issue runtime state
│   │   │   └── prompts/
│   │   │       ├── developer.md   ← Project-specific developer instructions
│   │   │       ├── tester.md      ← Project-specific tester instructions
│   │   │       └── architect.md   ← Project-specific architect instructions
│   │   └── another-project/
│   │       └── prompts/
│   │           ├── developer.md
│   │           └── tester.md
│   └── log/
│       └── audit.log              ← NDJSON event log (auto-managed)
├── AGENTS.md                      ← Agent identity documentation
└── HEARTBEAT.md                   ← Heartbeat operation guide
```

### Role instruction files

Role instructions are injected into worker sessions via the `agent:bootstrap` hook at session startup. The hook loads instructions from `devclaw/projects/<project>/prompts/<role>.md`, falling back to `devclaw/prompts/<role>.md`.

Edit to customize: deployment steps, test commands, acceptance criteria, coding standards.

**Source:** [`lib/dispatch/bootstrap-hook.ts`](../lib/dispatch/bootstrap-hook.ts)

---

## Audit Log

Append-only NDJSON at `<workspace>/devclaw/log/audit.log`. Auto-truncated to 250 lines.

**Source:** [`lib/audit.ts`](../lib/audit.ts)

### Event types

| Event | Trigger |
|---|---|
| `task_start` | Issue advanced to queue |
| `model_selection` | Level resolved to model ID |
| `work_finish` | Task completed |
| `work_heartbeat` | Heartbeat tick completed (background service) |
| `task_create` | Issue created |
| `task_set_level` | Level hint set on issue |
| `task_comment` | Comment added to issue |
| `tasks_status` | Project dashboard queried |
| `task_list` | Issue list browsed |
| `health` | Health scan completed |
| `heartbeat_tick` | Heartbeat service tick (background) |
| `project_register` | Project registered |

### Querying

```bash
# All task dispatches
cat audit.log | jq 'select(.event=="task_start")'

# All completions for a project
cat audit.log | jq 'select(.event=="work_finish" and .project=="my-webapp")'

# Model selections
cat audit.log | jq 'select(.event=="model_selection")'
```

---

## Issue Provider

DevClaw uses an `IssueProvider` interface (`lib/integrations/providers/provider.ts`) to abstract issue tracker operations. The provider is auto-detected from the git remote URL.

**Supported providers:**

| Provider | CLI | Detection |
|---|---|---|
| GitHub | `gh` | Remote contains `github.com` |
| GitLab | `glab` | Remote contains `gitlab` |

**Provider resilience:** All calls are wrapped with cockatiel retry (3 attempts, exponential backoff) + circuit breaker (opens after 5 consecutive failures, half-opens after 30s). See [`lib/integrations/providers/resilience.ts`](../lib/integrations/providers/resilience.ts).

**Planned:** Jira (via REST API)

**Source:** [`lib/integrations/providers/index.ts`](../lib/integrations/providers/index.ts)
