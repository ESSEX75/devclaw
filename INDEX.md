# DevClaw Code Index

This file is a source navigation map for agents and developers. It is not part of the npm package runtime surface.

## Change Routes

- Queue scanning and dispatch selection:
  `lib/application/queue`, `lib/application/workers`, `lib/state/issues`
- Worker completion and PR lifecycle:
  `lib/application/workers`, `lib/application/heartbeat`, `lib/domain/workflow`
- Issue creation and task management:
  `lib/application/tasks`, `lib/tools/tasks`, `lib/projection`
- Provider behavior:
  `lib/integrations/providers`
- OpenClaw sessions and bootstrap:
  `lib/integrations/openclaw`, `lib/application/workers`
- Config loading:
  `lib/state/config`
- Setup and onboarding:
  `lib/application/setup`, `lib/state/setup`, `lib/tools/admin`
- CLI behavior:
  `lib/cli`
- Role and model selection:
  `lib/roles`
- Projection integrity and repair:
  `lib/projection`, `lib/state/issues`, `lib/tools/issues`

## Layer Contracts

- `lib/domain/README.md`
- `lib/application/README.md`
- `lib/state/README.md`
- `lib/integrations/README.md`
- `lib/projection/README.md`
- `lib/tools/README.md`
- `lib/cli/README.md`

Detailed architecture contract: `docs/REFACTOR_ARCHITECTURE.md`.

## Validation Routes

- Architecture/import boundaries/tool registration: `npm run arch:check:strict`
- Typecheck: `npm run check`
- Build: `npm run build`
- Full test suite: `npm run test`
- Issue state and projection: `npm run test:issue-state`
- Package smoke: `npm pack --dry-run`

## Documentation Policy

Temporary refactor plans, task execution reports, and agent analysis do not belong under `docs/`. Keep them in the operator vault under `vault/generated`.

`WORK_STATE.md` is local-only coordination state. It is ignored by git and should be created only when a long-running branch needs it.
