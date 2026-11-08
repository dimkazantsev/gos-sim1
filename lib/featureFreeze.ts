/** Temporary load-shedding switches introduced 2026-11-06.
 * In-game chat restored 2026-11-08 after compute upgrade at owner's request.
 * Keep lazy chat loading, bounded requests, paging, and existing Realtime.
 * Telegram remains paused with its DB notification triggers disabled.
 */
export const CHAT_PAUSED = false;
export const TELEGRAM_PAUSED = true;
