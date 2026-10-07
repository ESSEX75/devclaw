/** Owns media contracts at the OpenClaw adapter boundary. */

/** Local media staged by the SDK or selected explicitly by the user. */
export type MediaAttachmentInfo = {
  /** Source path authorized by the caller. */
  localPath: string;
  /** Known media type, otherwise detected through the SDK. */
  mimeType?: string;
  /** Display filename, otherwise taken from the source basename. */
  filename?: string;
};
