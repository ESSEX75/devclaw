# Setup

`index.ts` exposes setup, onboarding, scope error guards, workspace configuration
operations, and exact-route inspection for tools, CLI, doctor, and notification use cases.

- `setup-plan.ts` validates requests without writes or commands. `run-setup.ts`
  applies the plan; preview and file-only operations never request scope approval.
- `tool-ownership.ts` reads validated project registries in SDK-resolved agent
  workspaces. An owner is trusted only in its own configured workspace. The
  selected setup agent is explicitly authorized even before project registration.
  Missing registries grant no ownership; corrupt or inaccessible registries abort
  policy mutation. Existing tool allowlists are not ownership evidence.
- `tool-policy.ts` builds permissions without I/O. SDK configuration mutation
  reads ownership from its fresh draft, preserves unrelated permissions, and denies
  DevClaw tools to nonowners. Explicit `allow` is extended without introducing the
  SDK-forbidden `allow` + `alsoAllow` combination. Administrative wildcard/global
  restrictions are preserved; setup does not promise to override them.
- `scopes.ts` owns approval policy and typed failures in `errors.ts`; integrations
  owns CLI arguments, execution, unsupported-command classification, and JSON
  validation. Explicit rejection/pending takes precedence over positive fields.
  Approval requires consistent evidence; a request can confirm only the scopes
  missing from its preceding check. An absent scopes command remains nonblocking.
- Route inspection requires an enabled channel/account and an exact group binding.
  SDK `group` and `channel` peer kinds are equivalent; `direct` is distinct.
  Duplicate bindings to the same owner are harmless; conflicting owners are rejected
  instead of depending on their order. This validates configured group routes, not
  live gateway connectivity or channel credentials.
- `onboarding.ts` selects the scenario using reads; `onboarding-instructions.ts`
  renders guidance. Ordinary setup preserves existing files, explicit refresh/reset
  owns replacement, and managed policy changes never use manual provider labels.

Ownership is read during configuration mutation, but project registration and the
SDK configuration store do not share a cross-store transaction. Concurrent ownership
changes require a subsequent setup run to refresh permissions.

Local SDK inspection for this stage used OpenClaw 2026.9.5: account disablement and
peer-kind equivalence are implemented by the SDK. Its installed CLI does not expose
`scopes check/request`; approval response handling is therefore tested with transport
fixtures, and the unavailable outcome remains part of the supported setup contract.
