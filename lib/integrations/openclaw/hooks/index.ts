/** Exposes SDK event registration while application resolves managed instruction and attachment ownership. */

export { registerAttachmentHook } from "./attachments.js";
export { registerBootstrapHook } from "./bootstrap.js";
export type { AttachmentHookActions, AttachmentHookContext, AttachmentHookRegistrar, BootstrapHookActions, BootstrapInstructionIdentity } from "./types.js";
