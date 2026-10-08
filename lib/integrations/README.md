# Integrations

Owns GitHub/GitLab and OpenClaw adapters; domain/application own workflow decisions,
state owns local persistence, and tools/CLI own user-facing formatting.
Local `issues.json` is authoritative for workflow and worker ownership; provider labels,
body metadata and gateway observations only verify or project that state.

## APIs and dependencies

- External consumers use `integrations/index.ts`, aggregating `openclaw`, `process` and `providers`.
- Aggregation entrypoints use `export *` from child `index.ts`; owning modules name supported exports.
- Internal siblings use the immediate owner's entrypoint; local files use implementation imports.
- Never import an ancestor barrel from its implementation or add compatibility facades.
- Types, schemas, guards and constants stay with their capability; implementation details use JSDoc.
- Keep contracts in this layer README; do not create nested README files.
- Composition injects application callbacks into hooks; integrations never import application.

## Provider ownership

`providers/index.ts` aggregates the eight production APIs below; `conformance/` is test-only.
Concrete facade entrypoints expose provider classes without exposing internal capabilities.
Each facade shares one transport, discovery instance and successful-only identity cache.

| Capability | Responsibility |
| --- | --- |
| `contracts` | Provider-neutral capability interfaces, issue/PR/comment DTOs and observation states. |
| `selection` | Factory, confirmed known-origin selection, inputs/results; only selection chooses an adapter. |
| `errors` | Normalized failure evidence, typed read/mutation errors and guards; no transport dependency. |
| `transport` | Checked CLI execution, per-instance retry/breaker policy and complete response decoding. |
| `attachments` | Shared safe filename normalization; actual uploads belong to concrete adapters. |
| `git` | Exact unqualified issue references in complete reachable Git history; no history cap or MR fallback. |
| `github`, `gitlab` | Concrete facade composition and provider-specific capabilities. |

Each concrete adapter root contains only `provider.ts` and `index.ts`.

| Internal capability | Responsibility |
| --- | --- |
| `api` | Shared placeholder paths, resource namespaces and wire lifecycle values. |
| `repository` | Confirmed repository/project identity, cache, schema/types and concrete GitHub paths. |
| `comments` | Shared validated comment/note wire schemas and inferred types. |
| `discovery` | Complete associated-request discovery, exact selection, request schemas/types and filters. |
| `issues`, `labels` | Explicit issue/label effects, issue schemas and GitHub mapping; no workflow selection. |
| `pull-requests` | Request status, diff, merge and shared Git-history observation. |
| `reviews` | Formal decisions, discussions and feedback, including the latest GitHub review per author. |
| `reactions` | Cosmetic endpoint-specific effects/observations; never durable delivery receipts. |
| `attachments` | Upload execution/confirmation, storage policy and GitLab multipart staging. |
| `health` | Authentication probes and optional GitHub core quota observations. |

Dependencies flow `pull-requests -> reviews -> reactions -> discovery -> repository`;
reviews-to-reactions applies to GitLab. Lower wire/API owners never depend on these operations.

## Process and provider guarantees

- Clean exit and complete capture are separate evidence. Reads reject clipped/failed streams before parsing.
- Timeout, signal, killed process, missing exit code and command exceptions leave mutation outcome unknown.
- Reads/idempotent setters retry classified transient/rate-limit failures; permanent failures never retry.
- Creation, comment POST, merge, upload and deletion submit once. Lost responses never authorize replay.
- Each adapter owns its breaker; failed identity reads do not poison future cache observations.
- JSON/schema errors stay unknown; numeric HTTP-like text cannot prove absence or authorize destructive recovery.
- Issue IDs must be positive safe integers matching the requested identity; missing issues need confirmed access proof.
- Required reads propagate typed errors rather than returning absence; only complete validated emptiness proves absence.
- Creation/comment success without confirmed identity remains unknown; unidentified creation needs explicit repair.
- Detection accepts exact known hosts and clean Git completion; unknown/self-hosted hosts need explicit selection.
- Application consumes typed error codes/outcome uncertainty and owns compensation and quota-preflight decisions.
- Application/projection selects workflow labels, adds the target before cleanup, and handles partial failure.

## Requests, feedback and uploads

- Discovery excludes foreign repository/project identities and selects newest IDs with open/merged/closed precedence.
- Native open links precede fallback; absent native opens allow fallback to augment historical candidates.
- Status, diff, feedback and merge honor an exact observed URL; disappeared targets never redirect to another request.
- Pagination includes CLI pages and GitHub cursor/pageInfo validation; partial GraphQL results never prove absence.
- Only confirmed unsupported GraphQL queries permit fallback; REST issue collections exclude GitHub PR entries.
- GitHub formal reviews use latest timestamp/ID per author; dismissal clears prior decisions, merge wins over reviews.
- Summary, inline and conversation IDs retain separate source kinds; GitLab DiffNote works without file position.
- GitHub inline/conversation reactions use their own endpoints; summaries have no supported reaction endpoint.
- GitLab note reactions share a namespace. Cosmetic reactions never replace application-owned full-content receipts.
- Formal changes remain actionable until superseded. Human inline reads are shared by status and feedback;
  empty/acknowledged context survives while each caller applies its own feedback policy.
- Application saves bytes before upload. Unconfirmed URLs never publish; non-formal receipts remain application-owned.
- GitLab validates host, full namespace and installation prefix, uses host credentials and cleans isolated temp files.
- GitHub uses unique resources and confirms path/SHA/download URL; credential-bearing or signed URLs are rejected.

## OpenClaw ownership and guarantees

`openclaw/index.ts` aggregates six capability APIs; SDK resources remain SDK-owned.

| Capability | Responsibility |
| --- | --- |
| `agents` | Active SDK registry and SDK workspace resolution, including implicit defaults. |
| `sessions` | Complete inventory, metrics, canonical keys, confirmed model patch/deletion and one worker submission. |
| `hooks` | SDK registration, mutable bootstrap resources and complete normalized attachment routes. |
| `media` | Ordered path/MIME pairing and SDK MIME detection; no local persistence. |
| `notifications` | One outbound submission with accepted/rejected/unknown outcomes. |
| `scopes` | Optional CLI transport/evidence; application selects permissions and approval policy. |

- Session absence requires every advertised store to be read/validated; bounded recent lists never prove absence.
- Unknown/stale token metrics remain unknown. Usage is fresh used tokens/capacity; sessions never prove local ownership.
- Application chooses/audits budget cleanup and whether optional deletion failure blocks dispatch.
- Model patches confirm exact key and resolved model before dispatch; aliases belong to gateway, not adapters.
- Worker turns use immutable application submission IDs; feedback cycles and health nudges keep distinct attempt identity.
- Bootstrap replaces only an exact persisted session/project-agent match, clears orchestrator text before prompt loading,
  and supports configured custom roles/levels. Missing/unregistered identities remain untouched.
- Attachment capture needs explicit scoped agent, account, conversation and consistent thread; pending/ambiguous routes skip.
- Notification fallback is allowed only before submission; rejection, response loss or exceptions afterward stay unknown.
  Clean completion proves acceptance, not receipt; optional message IDs never authorize replay.
- Scope evidence distinguishes absent commands from failures; denied/pending evidence overrides positive approval fields.

## Verification

Keep focused tests beside owners and shared cross-adapter contracts in `conformance/`.
Run architecture/logic review, `npm run arch:check:strict`, `npm run check`, `npm run build`,
`npm run test` and `git diff --check` before committing; verify the bundle's ESM import.
