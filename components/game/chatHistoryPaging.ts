import type {Message} from './types';

// Chat history is fetched from Supabase in bounded pages, not loaded and hidden.
export const CHAT_HISTORY_PAGE_SIZE=10;
export type ChatHistoryCursor=Pick<Message,'created_at'|'id'>;

/** Timestamp and UUID come from an RLS-authorised database row, never from input. */
export function chatHistoryCursorFilter(cursor:ChatHistoryCursor):string{
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(?:Z|[+-][0-9:]+)$/.test(cursor.created_at)||
    !/^[0-9a-f-]{36}$/i.test(cursor.id))throw new Error('Недопустимый курсор истории чата');
 // Same-timestamp messages are ordered by UUID, preventing gaps or duplicates.
 return 'created_at.lt.'+cursor.created_at+
  ',and(created_at.eq.'+cursor.created_at+',id.lt.'+cursor.id+')';
}
