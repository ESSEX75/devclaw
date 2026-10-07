# Integrations Layer

This layer owns concrete external adapters.

Integration modules talk to external systems such as GitHub, GitLab, OpenClaw
gateway/session APIs, and provider-specific capabilities. They should expose
small adapter functions and typed results for application use cases.

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
`openclaw/agent-workspace.ts` delegates workspace resolution to the SDK, including
implicit defaults, so ownership discovery does not duplicate SDK path rules.
Heartbeat applies strict state-owned registry inspection to those resolved paths
and scopes each project to its persisted agent identity.

`openclaw/attachment-hook.ts` owns SDK message hook registration and media event
normalization. It passes complete routing identities to application/tasks and
requires an explicit agent-scoped session plus account and conversation identity.
Unscoped or unstaged events are skipped; missing identity is never defaulted to an
agent or account. `attachment-media.ts` preserves path/MIME positional pairing.

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
