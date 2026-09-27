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

`openclaw/attachment-hook.ts` owns SDK message hook registration and media event
normalization. It passes complete routing identities to application/tasks and
requires an explicit agent-scoped session plus account and conversation identity.
Unscoped or unstaged events are skipped; missing identity is never defaulted to an
agent or account. `attachment-media.ts` preserves path/MIME positional pairing.
