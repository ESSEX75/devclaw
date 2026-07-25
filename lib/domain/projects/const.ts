/**
 * projects/const.ts — Projects and notification channel constants.
 */

/**
 * Supported notification channel constants.
 */
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
