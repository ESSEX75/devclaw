import type { SoftUnion } from "../../types.js";
import { ISSUE_PROVIDER } from "../issues/const.js";
import { NOTIFICATION_CHANNEL } from "../projects/const.js";

/** Supported issue tracking provider identifier. */
export type IssueProviderType = SoftUnion<typeof ISSUE_PROVIDER>;

/** Supported notification channel or messaging platform identifier. */
export type NotificationChannel = SoftUnion<typeof NOTIFICATION_CHANNEL>;
