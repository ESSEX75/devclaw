/** Persisted attachment metadata and filesystem operation contracts. */
/** One local attachment, optionally published through a provider. */
export type AttachmentMeta = {
  /** Stable attachment identity. */
  id: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Original display filename. */
  filename: string;
  /** Recorded media type. */
  mimeType: string;
  /** Stored byte count. */
  size: number;
  /** User or actor supplying the file. */
  uploader: string;
  /** ISO timestamp of the local save. */
  uploadedAt: string;
  /** Safe basename relative to the issue attachment directory. */
  localPath: string;
  /** Confirmed provider upload URL. */
  publicUrl?: string;
};
/** Current attachment index, validated before every mutation. */
export type AttachmentStore = {
  /** Indexed files for one issue. */
  attachments: AttachmentMeta[];
};
/** Bytes and display metadata supplied by the application. */
export type AttachmentFile = {
  /** File contents to persist. */
  buffer: Buffer;
  /** Original display name. */
  filename: string;
  /** Resolved media type. */
  mimeType: string;
  /** User or actor supplying the file. */
  uploader: string;
};
/** Source file read at the filesystem boundary before provider upload. */
export type AttachmentSource = {
  /** Original file bytes. */
  buffer: Buffer;
  /** Source basename for display. */
  filename: string;
  /** Absolute source path used for media detection. */
  filePath: string;
};
/** Evidence returned before attachment retention cleanup is audited. */
export type AttachmentPurgeManifestEntry = {
  /** Removed file basename. */
  filename: string;
  /** Removed file size. */
  size: number;
  /** SHA-256 digest of removed bytes. */
  sha256: string;
};

/** Audit checkpoint invoked before any attachment bytes are removed. */
export type AttachmentPurgeCheckpoint = (manifest: readonly AttachmentPurgeManifestEntry[]) => Promise<void>;
