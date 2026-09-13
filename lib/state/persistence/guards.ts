/**
 * Owns runtime guards shared by filesystem persistence boundaries.
 */

/**
 * Determine whether an unknown failure exposes a Node.js filesystem error code.
 *
 * @param value - Failure raised by a filesystem operation.
 */
export function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
