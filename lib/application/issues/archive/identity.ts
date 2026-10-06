/** Computes the immutable source identity used to recover archive-first writes. */

import { createHash } from "node:crypto";

import type { IssueRuntimeState } from "../../../domain/index.js";
import { ARCHIVE_HASH_ALGORITHM } from "./const.js";

/** Hash the exact authoritative snapshot transferred to archive.
 * @param state - Fresh local issue record.
 */
export function hashIssueState(state: IssueRuntimeState): string {
  return createHash(ARCHIVE_HASH_ALGORITHM).update(JSON.stringify(state)).digest("hex");
}
