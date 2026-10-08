# Integrations Layer

This layer owns concrete external adapters.

`process/index.ts` exposes pure transport evidence guards shared by adapters. A clean
exit and a complete output capture are separate facts. Providers and JSON-observation
adapters reject explicitly clipped output or stream capture failures before interpreting
response content or failure text. Notification/worker-turn acceptance can rely on clean
exit evidence without requiring an optional receipt body; these operations never fall
back or replay after submission.

## OpenClaw package ownership

The OpenClaw adapter exposes separate APIs through `agents/index.ts`, `sessions/index.ts`,
`hooks/index.ts`, `media/index.ts`, and the existing `notifications/index.ts` and
`scopes/index.ts`. Its organizational root has no barrel or compatibility files.
Cross-capability consumers use these APIs; implementations import their own local files.
Types and protocol constants belong to the capability that owns them.

- Agents read the active SDK registry and delegate workspace resolution to the SDK.
- Sessions own validated gateway observations, model acknowledgement, exact deletion,
  worker-turn submission and canonical session protocol identity. No session adapter
  selects a cleanup policy, changes local workflow state or writes worker audit events.
- Hooks register SDK handlers and normalize exact attachment routes. Application owns
  managed worker bootstrap identification, role prompt selection and project attachment
  routing. Mutable bootstrap resources retain their original SDK references.
- Media normalize local path/MIME metadata and delegate MIME detection to the SDK;
  state owns file reading and persistence.
- Notifications and scopes retain their existing independent transport contracts.

Session mutation confirmation requires clean process completion; a timeout, signal,
killed process or missing exit code cannot prove deletion or accepted submission.
Each worker turn is submitted once. Application owns budget-based cleanup decisions,
their audit and whether optional cleanup failure blocks dispatch.

## Provider package ownership

The provider root is an organizational directory. Shared capabilities own explicit
APIs; cross-capability consumers import the entrypoint that owns their dependency.

`providers/contracts/index.ts` exposes provider-neutral capability contracts, DTOs
and canonical observation constants. `providers/selection/index.ts` exposes
`createProvider`; selection owns adapter composition and verified known-origin detection.
The old root API is removed; consumers import the capability that owns their contract.
Workflow configuration is resolved by application and is not a provider factory input.

`providers/github/index.ts` and `providers/gitlab/index.ts` expose their concrete
provider facades. Each facade only composes and delegates to identity, discovery,
issues, labels, pull requests, reviews, reactions, attachments and health capabilities.
Schemas and issue mapping belong to the concrete provider. GitLab multipart staging
belongs to its attachment capability. No provider interprets workflow states or selects
which configured labels must be removed.

`errors/index.ts` exposes classified failure contracts and adapter classification APIs.
`transport/index.ts` exposes checked CLI execution, one resilience policy per adapter
instance, complete collection decoding and shared response-validation primitives.
Consumers use these entrypoints; error implementations never depend on transport.
Concrete implementations use capability entrypoints for shared contracts, errors,
transport, attachment-name policy and Git-history observations, and sibling
implementation imports within their own concrete package. No adapter imports selection
or a parent barrel.
Other consumers use the owning capability or concrete provider's `index.ts`. Internal
capability classes, concrete schemas and staging helpers are not supported public APIs.

The concrete facades retain one adapter instance, transport and successful identity
cache. Their internal responsibilities are being separated into capability packages;
sharing that instance does not require a flat implementation layout.
Workflow label creation, two-phase projection and optional anomaly observation belong
to application/projection; providers apply only explicit label additions/removals.

### Shared provider responsibility boundaries

The responsibility map below defines the implemented capability boundaries:

- `contracts/` owns provider-neutral capability interfaces, normalized issue/PR/comment
  DTOs and their observation registries. It does not own transport policies, error
  classification, factory inputs, or concrete provider wire schemas.
- `selection/` owns provider construction, verified origin-host detection, factory
  input/result types and known-host registries. Only this composition capability
  imports concrete provider facades to select an adapter.
- `errors/` owns normalized failure evidence, lookup/mutation error classes,
  classification, error guards and their types/registries. It does not depend on
  command execution, retry policies, selection, or concrete adapters.
- `transport/` owns checked command execution, instance-local retry/breaker policy,
  complete collection decoding and shared response-validation primitives. Concrete
  wire schemas stay with their adapters. Transport contracts and policies live here;
  transport uses `errors/`, never the reverse.
- `attachments/` owns shared attachment-name normalization and its filename policy.
  Provider-specific upload execution and staging remain in `github/` and `gitlab/`;
  the application-facing upload capability and input DTO remain in `contracts/`.
- `git/` owns exact issue-reference observations from complete local Git history and
  their history-query constants. It uses checked transport without choosing an adapter.
- `github/` and `gitlab/` retain concrete provider behavior. The formal-review selector
  in `github/review-observations.ts` is internal to that adapter.

Each capability exposes only its supported API through `index.ts`. Sibling
capabilities and external consumers import that entrypoint; implementation files use
local imports inside their owner. None imports a parent barrel or selection to reach
shared infrastructure. Types/constants migrate with their owners without duplicate
registries or forwarding files. The old root API and shared implementation files are
removed; consumers must use the current owning capability directly.

Focused error, pagination/recovery, Git-history and selection tests live beside their
owning capabilities. `conformance/` owns test-only verification of the shared adapter
contract through concrete GitHub/GitLab facades: issue/comment boundaries, attachments,
immutable dependency composition, complete pagination and PR/review observations.
It has no production API or barrel. Cross-adapter scenarios stay intact rather than
being duplicated or distributed by provider name. Local `issues.json` authority and
completion, pagination, replay, and uncertain-outcome guarantees remain unchanged.

### Concrete adapter responsibility boundaries

GitHub and GitLab are migrating to the following internal capability boundaries.
Until a capability is moved, its existing implementation path remains authoritative:

`api/`, `repository/`, `comments/` and `discovery/` are implemented in both adapters.
Wire schemas, inferred types and query/resource registries already belong to their
capability directories; remaining operation classes migrate separately. Shared wire
lifecycle values remain in `api/` because issue and request observations both use them.
GitHub operation capabilities are fully migrated; its root contains only the facade
and its public entrypoint. GitLab operation classes still use their existing root paths.

- `api/` owns shared placeholder endpoint construction and common resource/protocol
  identifiers. Capability-specific query selectors and policies belong to their owners.
- `repository/` owns confirmed repository/project identity, successful-only caching,
  identity schemas/types and GitHub paths built from that confirmed identity.
- `comments/` owns shared comment/note wire schemas and inferred types used by issues
  and reviews. It does not select PRs or interpret review decisions.
- `discovery/` owns complete associated-request discovery, exact selection, request
  observation schemas/types and discovery filters. It may use repository identity;
  it never depends on reviews, reactions or request mutation operations.
- `issues/` owns issue reads/mutations, issue schemas and GitHub issue mapping.
- `labels/` owns explicit label effects without choosing workflow transitions.
- `pull-requests/` owns request status, diff, merge and delegation to shared Git history.
- `reviews/` owns formal decisions, discussion/feedback observations and GitHub's
  latest-review selector. It may use discovery and GitLab reaction observations.
- `reactions/` owns cosmetic endpoint-specific effects/observations and may use discovery;
  it never depends on reviews or request status/merge operations.
- `attachments/` owns upload execution, acknowledgement validation and storage policies;
  GitLab multipart resources and installation URL validation remain within this owner.
- `health/` owns authentication probes and GitHub quota observations.

Only `provider.ts` and `index.ts` remain at each adapter root after migration. The
facade composes capabilities through their entrypoints and keeps a single transport,
repository cache and discovery instance. Siblings import the owning capability's
`index.ts`; implementation files use local imports within that capability. The root
API exposes only the completed provider facade, not internal capability classes/schemas.
Keep the dependency direction `pull-requests -> reviews -> reactions -> discovery ->
repository` (reviews-to-reactions applies to GitLab); lower wire/API owners never
import these orchestration capabilities. Do not add nested README files.

Integration modules talk to external systems such as GitHub, GitLab, OpenClaw
gateway/session APIs, and provider-specific capabilities. They should expose
small adapter functions and typed results for application use cases.

Provider issue JSON must carry a positive safe integer identity matching the explicitly
requested issue. Invalid, mismatched or malformed observations remain failed reads;
local schema/JSON decoding diagnostics cannot be mistaken for HTTP status evidence.
Provider-specific endpoint resources, wire lifecycle states and protocol selectors
belong to concrete `const.ts`; `contracts/types.ts` derives supported categories through
canonical registries. Concrete validators and endpoint builders stay internal to their
adapter. Shared diagnostic classifiers belong to the adapter-facing `errors/index.ts`
API; application consumes classified failures and guards instead of parsing diagnostics.

Provider issue lookups classify not-found, authorization, rate-limit, transient,
and unknown failures at the adapter boundary. Application code must branch on
these typed failures rather than inspecting provider error text.

Provider mutation errors also declare retryability and whether the request outcome
is unknown. Creation must never blindly retry an outcome-unknown mutation.

Adapters may expose a typed rate-limit snapshot for planned mutations. GitHub
repair preflight reads the core API budget; providers without a reliable quota
endpoint leave the optional capability unavailable and callers report that fact.
The OpenClaw session adapter exposes a typed worker-turn submission outcome.
Command timeouts and lost responses remain unknown; application orchestration
decides whether to retain or release its worker reservation.

Comment creation submits exactly once. Lost responses and missing comment identities
remain outcome-unknown; the adapter never repeats the POST automatically.

Provider commands declare replay safety: read, explicitly idempotent state change,
or one non-replayable mutation. Creation, comment POST, merge, upload and deletion
commands are never automatically replayed. Read/idempotent retries handle classified
temporary and rate-limit failures; permanent failures do not retry or open a breaker.
Each adapter instance owns its breaker. Abnormal termination and command exceptions
remain outcome-unknown even when stderr resembles a known server rejection.
Successful issue creation without a safe positive provider identity requires manual
repair. Typed mutation errors are preserved through repeated classification.

PR/MR lookup, required review observations and issue collections propagate typed read
failures rather than reporting absence. Empty validated responses can establish absence;
malformed/partial GraphQL responses cannot. Only an explicit rejected unsupported query
permits the GitHub timeline fallback. Repository identity caches successful observations
only, allowing later calls to recover after temporary failures.
Provider detection accepts exact known origin hosts and checks git completion. Unknown
and self-hosted hosts require explicit provider selection, which skips auto-detection.

Gateway session observations include inventory completeness. Only successfully reading
every advertised store and validating its records proves absence. Recent observations
are always merged, but their bounded list alone never proves a session is missing.
Unavailable or malformed token metrics remain unknown; context usage is fresh used
tokens divided by context capacity. External session observations never establish local
issue ownership or prove that a particular worker submission started.

Bootstrap hooks replace instructions only after application resolves an exact saved
worker session under its persisted project agent. Application validates runtime role
membership and loads the prompt; the adapter clears orchestrator instructions before
that load. Custom role and level names are not parsed through a built-in role pattern.

Review comments carry an explicit source kind: review summary, inline comment, or
PR conversation comment. This kind is independent of review status and optional
file location. GitHub inline reactions use the pull-request comment endpoint;
conversation reactions use issue comments. GitHub review summaries have no
supported REST reaction endpoint and are not reaction targets. GitLab inline and
conversation notes share the MR note reaction endpoint. Reactions are best-effort
indicators, not durable delivery receipts.

GitHub formal review decisions use the latest timestamp and ID per author; dismissal
clears that author's previous decision. Summary feedback is observed without querying
an unsupported summary reaction endpoint. Application compares non-formal summaries
against local full-content receipts. Formal changes requested remain actionable until
superseded, independently of delivery receipts.

PR discovery reads complete collections and selects the newest provider-local ID within
open, merged, then closed lifecycle precedence. Native open links take precedence over
convention-based fallback; when none remain, fallback candidates augment native history.
GitHub foreign-repository references and GitLab foreign-project IIDs are excluded.
Diff, feedback and merge accept an exact observed URL and fail instead of redirecting
to a newer request when that target disappears. Merged requests report MERGED regardless
of earlier approvals. GitLab inline kind uses the explicit DiffNote discriminator even
when optional file position is missing.

REST collections use provider CLI pagination, and GitHub timeline pagination includes
cursor/pageInfo validation. Truncated JSON or a final cursor indicating more pages is
an explicit failed observation. Complete issue listings exclude GitHub REST PR entries.
These transport contracts follow the [GitHub CLI API documentation](https://cli.github.com/manual/gh_api)
and [GitLab REST pagination documentation](https://docs.gitlab.com/api/rest/).
Direct-commit observation searches complete reachable history for an exact unqualified
issue reference. Numeric prefixes and independent GitLab MR references do not qualify.

Attachment uploads submit once and return only validated provider-confirmed locations.
GitLab resolves the installation prefix from matching project `web_url` and complete
`path_with_namespace`, preserving nested groups and self-hosted hosts. Credentials use
that confirmed host. Project-relative `url` and installation-relative `full_path` follow
the [GitLab Markdown uploads contract](https://docs.gitlab.com/api/project_markdown_uploads/).
Temporary upload names are flattened, length-limited and prefixed; bytes stay inside a
unique directory, cleaned after write, transport and response-validation failures.
GitHub confirms the Contents response's exact resource path, object SHA and download URL,
rejecting credential-bearing or signed URLs that cannot be persisted as public links
([Contents API contract](https://docs.github.com/en/rest/repos/contents));
unique upload resources avoid concurrent filename collisions. Application saves local
bytes before upload; an unavailable or unconfirmed remote result never publishes a URL.

Gateway turn idempotency uses an application-owned immutable submission identity.
New feedback cycles have distinct tokens even when their issue, role and session are
reused. Health nudges use their persisted attempt timestamp and session identity.

## Boundary Rules

- Keep provider API details in `lib/integrations/providers`.
- Keep OpenClaw runtime and session details in `lib/integrations/openclaw`.
- Do not own workflow decisions here; place those in `lib/domain` or
  `lib/application`.
- Do not format OpenClaw tool responses here.

Use `npm run arch:check:strict` after changing this layer.

`openclaw/scopes/index.ts` exposes optional scope CLI transport and validated
responses. It classifies absent commands narrowly; other process failures propagate.
Application setup owns required permissions and approval policy.
`openclaw/agents/index.ts` delegates workspace resolution to the SDK, including
implicit defaults, so ownership discovery does not duplicate SDK path rules.
Heartbeat applies strict state-owned registry inspection to those resolved paths
and scopes each project to its persisted agent identity.

`openclaw/hooks/index.ts` owns SDK message hook registration and media event
normalization. It passes complete routing identities to application/tasks and
requires an explicit agent-scoped session plus account and conversation identity.
Unscoped or unstaged events are skipped; missing identity is never defaulted to an
agent or account. `openclaw/media/index.ts` preserves path/MIME positional pairing.

`openclaw/notifications/index.ts` owns one outbound text submission. Runtime adapter
loading can fall back to CLI before `sendText` begins. Runtime rejection after
submission, lost responses, command exceptions, and abnormal exits are `unknown`;
missing transports are known local rejections. A fulfilled native send or clean
CLI exit is acceptance evidence, not proof that the recipient read the message.
CLI JSON contributes an optional message ID. Application passes the same configuration
snapshot used for exact route validation. No channel send is automatically repeated
by this adapter.

The session cleanup adapter owns the `sessions.delete` payload and command timeout.
Application decides whether optional stale-session cleanup failure blocks dispatch.

The session model adapter awaits `sessions.patch --json` and validates its persisted
acknowledgement, exact session key, and resolved model identity. The gateway owns
model aliases and normalization. Command failure or absent confirmation blocks
worker submission; a model patch never submits a task by itself.
