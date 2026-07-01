# Legacy Code Inventory

Strategy: `remove_by_default`. DevClaw is still in development and has no external users, so compatibility for old workspace, config, and session formats is removed unless current runtime behavior or provider API limitations require it.

| Area | Path | Status | Decision |
| --- | --- | --- | --- |
| ChannelId-keyed project schema migration | `lib/state/projects/schema-migration.ts` | `remove_now` | Deleted. Current `projects.json` is project-first and keyed by slug. |
| Project worker/role/level migration aliases | `lib/state/projects/migrations.ts` | `remove_now` | Deleted. Current worker state uses per-level `workers.<role>.levels`. |
| Legacy project fields | `lib/domain/projects/types.ts`, `lib/state/projects/store.ts` | `remove_now` | Removed `LegacyProject`, legacy schema detection, and per-project migration on read. |
| Old config names | `lib/state/config/loader.ts` | `remove_now` | Removed `config.yaml` and `workflow.json` config fallback reads. Current config is `devclaw/workflow.yaml`. |
| Deprecated role-level `maxWorkers` | `lib/state/config/types.ts`, `lib/state/config/schema.ts` | `remove_now` | Removed deprecated role-level field. Per-level concurrency remains `models.<level>.maxWorkers` or `workflow.maxWorkersPerLevel`. |
| Legacy session keys without slot suffix | `lib/dispatch/bootstrap-hook.ts` | `remove_now` | Removed parsing fallback for `project-role-level`; current sessions require `project-role-level-nameOrIndex`. |
| Old prompt paths | `lib/dispatch/bootstrap-hook.ts` | `remove_now` | Removed `projects/roles/*` prompt lookup. Current prompts live under `devclaw/prompts` or `devclaw/projects/<project>/prompts`. |
| Legacy notify labels by channel ID | `lib/workflow/labels.ts` | `remove_now` | Removed `notify:<channelId>` resolution. Current labels use `notify:<channelType>:<nameOrIndex>`. |
| Attachment hook top-level project `channelId` | `lib/dispatch/attachment-hook.ts` | `remove_now` | Removed top-level `project.channelId` lookup. Current channel data is `project.channels[]`. |
| Config diff/reset tools | `lib/tools/admin/config-diff.ts`, `lib/tools/admin/config-reset.ts` | `remove_now` | Already deleted in step 02; not public DevClaw tools. |
| Shared `lib/types.ts` aliases | `lib/types.ts` | `remove_now` | Already deleted in step 02; no usage remains. |
| Provider PR/MR fallback paths | `lib/integrations/providers/github.ts`, `lib/integrations/providers/gitlab.ts`, `lib/integrations/providers/provider.ts` | `keep_provider_limitation` | Kept. GitHub/GitLab APIs can report incomplete PR/MR state; fallback paths are provider behavior, not old user data migration. |
| Queue label fallback | `lib/services/queue-scan.ts` | `keep_current_runtime` | Kept. Provider labels remain a visual projection and recovery signal when local issue state is incomplete. |
| Setup layout migration | `lib/setup/migrate-layout.ts` | `keep_current_runtime` | Kept for now because setup/bootstrap still call `ensureWorkspaceMigrated` before default-file creation. It should be reassessed when setup ownership moves into `state/config`. |

