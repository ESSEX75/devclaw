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

Review comments carry an explicit source kind: review summary, inline comment, or
PR conversation comment. This kind is independent of review status and optional
file location. GitHub inline reactions use the pull-request comment endpoint;
conversation reactions use issue comments. GitHub review summaries have no
supported REST reaction endpoint and are not reaction targets. GitLab inline and
conversation notes share the MR note reaction endpoint. Reactions are best-effort
indicators, not durable delivery receipts.

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
