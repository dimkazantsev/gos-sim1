-- Compatibility fix for live Supabase where the first event push migration
-- was applied from an earlier, overly verbose payload implementation.
-- No table rewrites, data mutations, extra channels, or new triggers.
CREATE OR REPLACE FUNCTION private.broadcast_game_event_invalidation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 v_case_col text;
 v_recipient_col text;
 v_new text;
 v_old text;
 v_source text;
 v_item record;
 v_recipients uuid[];
BEGIN
 IF TG_TABLE_NAME NOT IN
  ('event_assignments','event_collaboration_invites','event_cases',
   'event_decisions','event_case_outcomes','event_discussion_messages',
   'event_authority_evidence','event_case_routing') THEN
  RAISE EXCEPTION 'Unsupported event invalidation source';
 END IF;
 v_case_col:=CASE WHEN TG_TABLE_NAME='event_cases' THEN 'id' ELSE 'case_id' END;
 v_recipient_col:=CASE WHEN TG_TABLE_NAME IN
  ('event_assignments','event_collaboration_invites') THEN 'recipient_id' ELSE 'NULL::uuid' END;
 v_new:=format('SELECT game_id,%s AS case_id,%s AS recipient_id FROM new_event_rows',v_case_col,v_recipient_col);
 v_old:=format('SELECT game_id,%s AS case_id,%s AS recipient_id FROM old_event_rows',v_case_col,v_recipient_col);
 -- Both sides of a collaboration invitation need to see accept/decline.
 -- No invitation content is broadcast: IDs only, inside the existing game room.
 IF TG_TABLE_NAME='event_collaboration_invites' THEN
  v_new:=v_new||' UNION SELECT game_id,case_id,inviter_id FROM new_event_rows';
  v_old:=v_old||' UNION SELECT game_id,case_id,inviter_id FROM old_event_rows';
 END IF;
 v_source:=CASE TG_OP
  WHEN 'INSERT' THEN v_new
  WHEN 'DELETE' THEN v_old
  WHEN 'UPDATE' THEN v_old||' UNION '||v_new
 END;
 -- A participant's answer updates their own assignment to 'resolved'. The
 -- submitting client already refreshed locally; do not send 100 room-wide
 -- Broadcast deliveries per such acknowledgment. The final case outcome has
 -- its own push. Reopening or changing a recipient still invalidates.
 IF TG_TABLE_NAME='event_assignments' AND TG_OP='UPDATE' THEN
  v_source:='SELECT game_id,case_id,recipient_id FROM new_event_rows WHERE status=''pending'''
    ||' UNION SELECT o.game_id,o.case_id,o.recipient_id FROM old_event_rows o'
    ||' JOIN new_event_rows n ON n.id=o.id'
    ||' WHERE o.recipient_id IS DISTINCT FROM n.recipient_id'
    ||' OR o.game_id IS DISTINCT FROM n.game_id OR o.case_id IS DISTINCT FROM n.case_id';
 END IF;
 FOR v_item IN EXECUTE
  'SELECT game_id,coalesce(array_remove(array_agg(DISTINCT recipient_id),NULL),ARRAY[]::uuid[]) recipients,'
  ||'coalesce(array_agg(DISTINCT case_id),ARRAY[]::uuid[]) cases FROM ('
  ||v_source||') rows_changed WHERE game_id IS NOT NULL GROUP BY game_id'
 LOOP
  v_recipients:=v_item.recipients;
  IF TG_TABLE_NAME IN ('event_case_outcomes','event_cases','event_case_routing') THEN
   SELECT coalesce(array_agg(DISTINCT x.recipient_id),ARRAY[]::uuid[])
     INTO v_recipients
   FROM (
    SELECT a.recipient_id FROM public.event_assignments a
     WHERE a.game_id=v_item.game_id AND a.case_id=ANY(v_item.cases)
    UNION
    SELECT i.recipient_id FROM public.event_collaboration_invites i
     WHERE i.game_id=v_item.game_id AND i.case_id=ANY(v_item.cases)
   ) x;
  END IF;
  PERFORM realtime.send(
   jsonb_build_object('table',TG_TABLE_NAME,'recipients',v_recipients,
    'case_ids',CASE WHEN TG_TABLE_NAME='event_discussion_messages' THEN v_item.cases ELSE ARRAY[]::uuid[] END),
   'event_feed_changed',
   'gos-id-live:'||v_item.game_id::text,
   true
  );
 END LOOP;
 RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION private.broadcast_game_event_invalidation() FROM PUBLIC,anon,authenticated;
