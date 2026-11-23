
-- Private Government chat: one room per game, only after the Cabinet is formed.
CREATE UNIQUE INDEX IF NOT EXISTS government_chat_one_per_game
ON public.chat_channels(game_id) WHERE kind='private' AND name='Правительство РФ';

CREATE OR REPLACE FUNCTION private.sync_government_chat(p_game uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_channel uuid; v_ready boolean; v_pm integer; v_ministers integer; v_ids uuid[];
BEGIN
 IF p_game IS NULL THEN RETURN; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('government-chat:'||p_game::text,0));
 SELECT EXISTS(SELECT 1 FROM public.game_stages WHERE game_id=p_game AND stage_no=9 AND status='completed')
    AND EXISTS(SELECT 1 FROM public.government_structures WHERE game_id=p_game AND status='approved')
 INTO v_ready;
 SELECT id INTO v_channel FROM public.chat_channels
 WHERE game_id=p_game AND kind='private' AND name='Правительство РФ' LIMIT 1;
 IF NOT v_ready THEN
   IF v_channel IS NOT NULL THEN
     DELETE FROM public.channel_members WHERE channel_id=v_channel;
   END IF;
   RETURN;
 END IF;

 SELECT count(DISTINCT a.user_id)::int INTO v_pm
 FROM public.game_office_assignments a
 JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id
 WHERE a.game_id=p_game AND a.status='active'
   AND lower(btrim(a.role_title))='председатель правительства российской федерации'
   AND m.kind='student' AND m.roster_archived_at IS NULL;

 SELECT count(DISTINCT u.unit_key)::int INTO v_ministers
 FROM public.institution_units u
 JOIN public.game_members m ON m.game_id=u.game_id AND m.user_id=u.head_user_id
 WHERE u.game_id=p_game AND u.unit_kind='ministry'
   AND u.unit_key IN ('social','economic','defence','foreign','internal')
   AND m.kind='student' AND m.roster_archived_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.government_nominations n
     WHERE n.game_id=u.game_id AND n.office_key='ministry_'||u.unit_key
       AND n.candidate_user_id=u.head_user_id AND n.status='appointed'
   );

 -- Do not create rooms for incomplete Governments. Existing room stays through
 -- temporary vacancies; membership always follows current appointments.
 IF v_channel IS NULL AND (v_pm<>1 OR v_ministers<>5) THEN RETURN; END IF;
 IF v_channel IS NULL THEN
   INSERT INTO public.chat_channels(game_id,name,kind,created_by)
   VALUES(p_game,'Правительство РФ','private',NULL)
   ON CONFLICT DO NOTHING RETURNING id INTO v_channel;
   IF v_channel IS NULL THEN
     SELECT id INTO v_channel FROM public.chat_channels
     WHERE game_id=p_game AND kind='private' AND name='Правительство РФ' LIMIT 1;
   END IF;
 END IF;
 IF v_channel IS NULL THEN RAISE EXCEPTION 'Не удалось создать чат Правительства РФ'; END IF;

 SELECT array_agg(DISTINCT d.user_id) INTO v_ids FROM (
   SELECT a.user_id FROM public.game_office_assignments a
   JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id
   WHERE a.game_id=p_game AND a.status='active'
      AND lower(btrim(a.role_title))='председатель правительства российской федерации'
      AND m.kind='student' AND m.roster_archived_at IS NULL
   UNION
   SELECT u.head_user_id FROM public.institution_units u
   JOIN public.game_members m ON m.game_id=u.game_id AND m.user_id=u.head_user_id
   WHERE u.game_id=p_game AND u.unit_kind='ministry'
     AND u.unit_key IN ('social','economic','defence','foreign','internal')
     AND m.kind='student' AND m.roster_archived_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.government_nominations n
       WHERE n.game_id=u.game_id AND n.office_key='ministry_'||u.unit_key
         AND n.candidate_user_id=u.head_user_id AND n.status='appointed'
     )
 ) d;
 v_ids:=coalesce(v_ids,ARRAY[]::uuid[]);
 INSERT INTO public.channel_members(channel_id,user_id)
 SELECT v_channel,d.user_id FROM unnest(v_ids) d(user_id) ON CONFLICT DO NOTHING;
 DELETE FROM public.channel_members cm
 WHERE cm.channel_id=v_channel AND NOT (cm.user_id=ANY(v_ids));
END; $$;
REVOKE ALL ON FUNCTION private.sync_government_chat(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.sync_government_chat_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_game uuid;
BEGIN
 IF TG_OP='DELETE' THEN v_game:=OLD.game_id; ELSE v_game:=NEW.game_id; END IF;
 IF TG_TABLE_NAME='game_stages' THEN
   IF NEW.stage_no<>9 THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='government_nominations' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.office_key NOT LIKE 'ministry_%' THEN RETURN NEW; END IF;
   ELSIF TG_OP='DELETE' THEN
     IF OLD.office_key NOT LIKE 'ministry_%' THEN RETURN OLD; END IF;
   ELSE
     IF NEW.office_key NOT LIKE 'ministry_%' AND OLD.office_key NOT LIKE 'ministry_%' THEN RETURN NEW; END IF;
   END IF;
 ELSIF TG_TABLE_NAME='institution_units' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.unit_kind<>'ministry' THEN RETURN NEW; END IF;
   ELSIF TG_OP='DELETE' THEN
     IF OLD.unit_kind<>'ministry' THEN RETURN OLD; END IF;
   ELSE
     IF NEW.unit_kind<>'ministry' AND OLD.unit_kind<>'ministry' THEN RETURN NEW; END IF;
   END IF;
 ELSIF TG_TABLE_NAME='game_office_assignments' THEN
   IF TG_OP='INSERT' THEN
     IF lower(btrim(NEW.role_title))<>'председатель правительства российской федерации' THEN RETURN NEW; END IF;
   ELSIF TG_OP='DELETE' THEN
     IF lower(btrim(OLD.role_title))<>'председатель правительства российской федерации' THEN RETURN OLD; END IF;
   ELSE
     IF lower(btrim(NEW.role_title))<>'председатель правительства российской федерации'
       AND lower(btrim(OLD.role_title))<>'председатель правительства российской федерации' THEN RETURN NEW; END IF;
   END IF;
 END IF;
 PERFORM private.sync_government_chat(v_game);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.sync_government_chat_trigger() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS government_chat_stage9 ON public.game_stages;
CREATE TRIGGER government_chat_stage9 AFTER UPDATE OF status ON public.game_stages
FOR EACH ROW WHEN (NEW.stage_no=9 AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION private.sync_government_chat_trigger();

DROP TRIGGER IF EXISTS government_chat_office ON public.game_office_assignments;
CREATE TRIGGER government_chat_office AFTER INSERT OR DELETE OR UPDATE OF user_id,role_title,status
ON public.game_office_assignments FOR EACH ROW EXECUTE FUNCTION private.sync_government_chat_trigger();

DROP TRIGGER IF EXISTS government_chat_ministries ON public.institution_units;
CREATE TRIGGER government_chat_ministries AFTER INSERT OR DELETE OR UPDATE OF unit_kind,unit_key,head_user_id
ON public.institution_units FOR EACH ROW EXECUTE FUNCTION private.sync_government_chat_trigger();

DROP TRIGGER IF EXISTS government_chat_nominations ON public.government_nominations;
CREATE TRIGGER government_chat_nominations AFTER INSERT OR DELETE OR UPDATE OF office_key,status,candidate_user_id
ON public.government_nominations FOR EACH ROW EXECUTE FUNCTION private.sync_government_chat_trigger();

DROP TRIGGER IF EXISTS government_chat_member_archive ON public.game_members;
CREATE TRIGGER government_chat_member_archive AFTER UPDATE OF kind,roster_archived_at
ON public.game_members FOR EACH ROW
WHEN (OLD.kind IS DISTINCT FROM NEW.kind OR OLD.roster_archived_at IS DISTINCT FROM NEW.roster_archived_at)
EXECUTE FUNCTION private.sync_government_chat_trigger();

-- Keep the existing overview contract, only admit the second named group room.
CREATE OR REPLACE FUNCTION public.get_my_chat_overview(p_game_id uuid)
RETURNS TABLE(channel_id uuid,last_message_at timestamptz,last_message_text text,
last_message_author_id uuid,unread_count bigint,mention_count bigint,
last_sent_at timestamptz,last_read_at timestamptz,pinned_at timestamptz,pinned_rank integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public','private','pg_temp'
AS $$
WITH accessible AS (
 SELECT c.id,c.created_at FROM public.chat_channels c
 WHERE c.game_id=p_game_id AND private.can_access_channel(c.id)
 AND (c.kind<>'private'
   OR (c.kind='private' AND c.name IN ('Совет ГД','Правительство РФ'))
   OR (SELECT count(*) FROM public.channel_members cm WHERE cm.channel_id=c.id)=2)
), state AS (
 SELECT s.* FROM public.chat_channel_state s
 WHERE s.game_id=p_game_id AND s.user_id=(SELECT auth.uid())
)
SELECT a.id,lm.created_at,lm.text,lm.author_id,
 (SELECT count(*) FROM public.chat_messages m
  WHERE m.channel_id=a.id AND m.author_id IS DISTINCT FROM (SELECT auth.uid())
  AND m.created_at>coalesce(s.last_read_at,'epoch'::timestamptz)),
 (SELECT count(*) FROM public.chat_mentions mn
  WHERE mn.channel_id=a.id AND mn.mentioned_user_id=(SELECT auth.uid()) AND mn.read_at IS NULL),
 s.last_sent_at,s.last_read_at,s.pinned_at,s.pinned_rank
FROM accessible a
LEFT JOIN state s ON s.channel_id=a.id
LEFT JOIN LATERAL (
 SELECT m.created_at,m.text,m.author_id FROM public.chat_messages m
 WHERE m.channel_id=a.id ORDER BY m.created_at DESC LIMIT 1
) lm ON true
ORDER BY CASE WHEN s.pinned_at IS NOT NULL THEN 0 ELSE 1 END,
 s.pinned_rank NULLS LAST,lm.created_at DESC NULLS LAST,a.created_at DESC;
$$;

-- One-time backfill for games whose government is already fully formed.
DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT DISTINCT s.game_id FROM public.game_stages s WHERE s.stage_no=9 AND s.status='completed'
 LOOP PERFORM private.sync_government_chat(r.game_id); END LOOP;
END; $$;
