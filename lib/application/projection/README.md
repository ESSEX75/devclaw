# Managed Projection Coordinator

This application capability reconciles provider labels from authoritative local issue state. `coordinator.ts` owns the issue lock, fresh state and provider reads, deterministic diff invocation, read-back verification, integrity updates, and audit. `apply.ts` performs only the requested provider label mutations. `types.ts` owns the narrow provider and reconciliation contracts.

The pure `lib/projection` package continues to own label and metadata rendering and diffing. The coordinator preserves unmanaged provider labels. A provider mutation or read-back failure leaves the active issue in `integrity_error`; a verified pass clears the error. Callers that already hold the issue lock use `reconcileManagedLabelsLocked` to avoid nested locking.
