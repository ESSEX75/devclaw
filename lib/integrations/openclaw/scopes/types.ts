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

/** Installed CLI returned a fully validated response; application interprets approval policy. */
type SupportedScopeCommand = {
  /** Observed installed CLI capability. */
  supported: true;
  /** Validated transport response, without inferred permission grants. */
  result: ScopeCommandResult;
};

/** A clean rejected unsupported command establishes that the optional capability is absent. */
type UnsupportedScopeCommand = {
  /** CLI capability absence, independently of operational failures. */
  supported: false;
};

/** Distinguish missing optional CLI support from a validated response. */
export type ScopeCommandOutcome = SupportedScopeCommand | UnsupportedScopeCommand;
