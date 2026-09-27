/** Narrows unknown failures to the repair command error contract. */
import { IssueRepairFailure } from "./failure.js";

/** Check whether a caught value is a stable repair failure.
 * @param error - Unknown failure caught at the application boundary.
 */
export function isIssueRepairFailure(error: unknown): error is IssueRepairFailure {
  return error instanceof IssueRepairFailure;
}
