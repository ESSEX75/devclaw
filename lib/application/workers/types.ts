/** Exact delivery identity shared by worker dispatch and recovery. */

/** Instruction owner proven by an exact persisted worker session and its project agent. */
export type WorkerBootstrapIdentity = {
  /** Canonical project containing the saved worker slot. */
  projectSlug: string;
  /** Configured runtime role owning that slot. */
  role: string;
};

/** Slot and submission identity required before changing delivery evidence. */
export type WorkerDeliverySlotIdentity = {
  /** Configured role owning the reserved slot. */
  role: string;
  /** Configured worker level. */
  level: string;
  /** Concrete slot index within the level. */
  slotIndex: number;
  /** Exact worker session identity. */
  sessionKey: string;
  /** Submission token fencing callbacks and operator decisions. */
  deliveryId: string;
};
