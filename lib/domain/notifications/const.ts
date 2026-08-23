/** Supported notification channel constants. */
export const NOTIFICATION_CHANNEL = {
  /** Telegram messenger notification channel. */
  TELEGRAM: "telegram",
  /** WhatsApp messenger notification channel. */
  WHATSAPP: "whatsapp",
  /** Discord chat platform notification channel. */
  DISCORD: "discord",
  /** Slack workspace notification channel. */
  SLACK: "slack",
} as const;

/** Prefix used for notification routing labels. */
export const NOTIFY_LABEL_PREFIX = "notify:";

/** Color used for notification routing labels. */
export const NOTIFY_LABEL_COLOR = "#e4e4e4";
