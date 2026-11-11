-- Prevent unchanged chat read receipts from generating UPDATE WAL and
-- per-subscriber Realtime RLS work. No change to message delivery or read rights.
-- The existing (channel_id, created_at) index makes the unread check selective.
CREATE OR REPLACE FUNCTION public.mark_chat_channel_read(p_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
 v_game uuid;
 v_now timestamptz := now();
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT private.can_access_channel(p_channel_id) THEN
  RAISE EXCEPTION 'Нет доступа к диалогу.';
 END IF;
 SELECT game_id INTO v_game FROM public.chat_channels WHERE id=p_channel_id;
 IF v_game IS NULL THEN
  RAISE EXCEPTION 'Диалог не найден.';
 END IF;

 -- First access creates a row as before. Repeat calls write only if a
 -- message was created after the previous read, keeping new messages
 -- immediately markable while avoiding writes for unchanged conversations.
 INSERT INTO public.chat_channel_state(game_id,channel_id,user_id,last_read_at,updated_at)
 VALUES(v_game,p_channel_id,(SELECT auth.uid()),v_now,now())
 ON CONFLICT(channel_id,user_id) DO UPDATE
 SET last_read_at=greatest(coalesce(chat_channel_state.last_read_at,'epoch'::timestamptz),excluded.last_read_at),
     updated_at=now()
 WHERE chat_channel_state.last_read_at IS NULL
    OR EXISTS (
     SELECT 1 FROM public.chat_messages msg
     WHERE msg.channel_id=p_channel_id
       AND msg.created_at>chat_channel_state.last_read_at
    );

 -- Mentions remain independent: even if no newer message exists, a
 -- newly added mention on an older message must still be marked read.
 UPDATE public.chat_mentions
 SET read_at=coalesce(read_at,v_now)
 WHERE channel_id=p_channel_id
   AND mentioned_user_id=(SELECT auth.uid())
   AND read_at IS NULL;
END;
$function$;

-- Existing EXECUTE grants and all RLS policies are preserved by CREATE OR REPLACE.
