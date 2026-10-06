/** Defines filesystem identifiers shared by state persistence primitives. */

/** Suffix appended to a protected state file to derive its lock path. */
export const LOCK_FILE_SUFFIX = ".lock";

/** Suffix identifying an incomplete sibling used during atomic replacement. */
export const TEMPORARY_FILE_SUFFIX = ".tmp";

/** Number of renewal intervals that fit inside one live lock lease. */
export const LOCK_RENEWAL_INTERVAL_DIVISOR = 3;

/** Encoding used by persisted text documents and registries. */
export const STATE_TEXT_ENCODING = "utf-8";

/** Filesystem outcomes that repositories explicitly handle. */
export const FILESYSTEM_ERROR_CODE = {
  NOT_FOUND: "ENOENT",
  ALREADY_EXISTS: "EEXIST",
} as const;

/** Exclusive create mode preserving existing workspace files. */
export const CREATE_ONLY_FILE_FLAG = "wx";
