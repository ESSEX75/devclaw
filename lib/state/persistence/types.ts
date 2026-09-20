/** Defines contracts shared by state persistence primitives and repositories. */

/** Timing policy selected by the repository that owns a filesystem lock. */
export type FileLockOptions = {
  /** Maximum time to wait before rejecting lock acquisition. */
  timeoutMs: number;
  /** Delay between attempts while another valid owner holds the lock. */
  retryMs: number;
  /** Maximum lock age before recovery may remove it. */
  staleMs: number;
};
