/** Defines filesystem identifiers shared by state persistence primitives. */

/** Suffix appended to a protected state file to derive its lock path. */
export const LOCK_FILE_SUFFIX = ".lock";

/** Suffix identifying an incomplete sibling used during atomic replacement. */
export const TEMPORARY_FILE_SUFFIX = ".tmp";

/** Number of renewal intervals that fit inside one live lock lease. */
export const LOCK_RENEWAL_INTERVAL_DIVISOR = 3;
