# Issue runtime

`index.ts` exposes runtime resolution, writes, initial creation drafts, and their
owned contracts. Exported types are declared in `types.ts`; resolution variants
remain local named types. Domain policies and routing labels are reused from
`lib/domain` rather than copied into application constants.

- `resolve.ts` reads local truth without mutations. Provider labels are observed
  only for uninitialized issues. A managed record retains its stored key/label;
  `stateConfig` is null if that pair no longer matches the current workflow.
- `write.ts` selects initialization or update using the fresh record inside the
  state transaction. Existing records preserve omitted fields, including null,
  and never import provider labels. Explicit state or label changes derive the
  omitted counterpart from the supplied workflow; mismatched pairs reject the
  write. An update without workflow overrides preserves the recorded pair even
  after configuration drift. Provider identity cannot change through this API.
- `initialization.ts` interprets labels only when no record exists. Explicit
  choices take precedence. Inferring a role/level requires `initializationRoles`
  from resolved project configuration; without it, omitted assignments are null.
  Arbitrary colon labels and unconfigured levels never become assignments.
  Ambiguous configured assignments, routing policies, or workflow labels require
  explicit choices rather than first-label wins.
- `creation.ts` builds an initial draft for the creation saga from already
  validated lifecycle input. It does not persist or verify provider state.

Callers choosing roles explicitly remain responsible for validating those choices
against their resolved configuration. This package does not substitute built-in
roles for custom configuration. Existing-state provider import remains an explicit
repair operation. Persistence, locking, and atomic writes stay in `lib/state`.
