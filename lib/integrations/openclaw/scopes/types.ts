/** Validated response contracts for the optional OpenClaw scopes CLI. */

/** Validated fields returned by the OpenClaw approval CLI. */
export type ScopeCommandResult = {
  /** Whether the transport reports success. */
  ok?: boolean;
  /** Reported transport or preflight status. */
  status?: string;
  /** Permissions confirmed by the gateway. */
  approved?: string[];
  /** Permissions not yet granted. */
  missing?: string[];
  /** Approval request identifier when one exists. */
  requestId?: string;
  /** Transport-provided diagnostic text. */
  message?: string;
};

/** Distinguishes a missing CLI capability from a successful command response. */
export type ScopeCommandOutcome =
  | { /** CLI capability is installed. */ supported: true; /** Validated JSON payload. */ result: ScopeCommandResult }
  | { /** CLI capability is not installed. */ supported: false };
