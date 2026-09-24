# Managed Task Creation

This capability owns one durable provider issue creation operation per idempotency
key. `index.ts` exposes only the creation command, heartbeat reconciliation, and
their input/result contracts. Other modules in this subpackage are private.

The command binds the key to a payload under the creation lock. The runner
records that provider mutation has started before calling the provider. A known
rejection may be retried; a started mutation without a persisted provider
identity requires manual repair. Reconciliation re-reads each operation under
the same lock and never blindly repeats an ambiguous create.

Provider identity is persisted before projection. Projection is applied and
verified through provider read-back before `issue-runtime` writes local state.
The operation becomes ready only after that local commit; queue scans ignore
every earlier status. Audit events describe persisted checkpoints and do not
decide recovery status.

Keep provider error classification in integrations. This capability maps typed
provider failures to creation recovery policy and uses only the provider methods
listed in `CreationProvider`.
