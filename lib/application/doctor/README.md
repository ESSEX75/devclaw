# Doctor

`index.ts` exposes only `runRoutingDoctor(runtime, workspaceDir)` to adapters.

- `routing.ts` coordinates configuration and project archive reads. It performs no
  mutations, command calls, initialization, or cleanup.
- `report.ts` builds findings from loaded observations without I/O. Setup owns
  exact-route validation and the required tool list; doctor owns report severity
  and diagnostic codes in `const.ts`. Contracts belong in `types.ts`.
- A project configuration/archive read failure produces an
  `archive.inspection_failed` error and makes the report unsuccessful. Other
  projects retain their findings and counters. Failed projects have no fabricated
  zero-valued archive row.
- Root runtime configuration or project-registry failures reject the operation:
  without those inputs the routing/ownership matrix cannot be inspected.
- `routing.ok` describes route and tool-policy checks only. Archive findings can
  still make the overall report unsuccessful. Retention-order information is
  diagnostic guidance, not a guarantee that attachment cleanup has run.

Internal builders and constants are not part of the adapter API. Doctor never
repairs routing, changes tool access, or applies retention.
