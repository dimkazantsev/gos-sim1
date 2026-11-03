-- GOС.ID. Database-only, private, metadata-only game event invalidations.
-- Transition-table triggers coalesce a multi-recipient INSERT into ONE broadcast.
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
 FOR v_item IN EXECUTE
  'SELECT game_id,coalesce(array_remove(array_agg(DISTINCT recipient_id),NULL),ARRAY[]::uuid[]) recipients,'
  ||'coalesce(array_agg(DISTINCT case_id),ARRAY[]::uuid[]) cases FROM ('
  ||v_source||') rows_changed WHERE game_id IS NOT NULL GROUP BY game_id'
 LOOP
  v_recipients:=v_item.recipients;
  IF TG_TABLE_NAME='event_case_outcomes' THEN
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
   jsonb_build_object('table',TG_TABLE_NAME,'recipients',v_recipients,'case_ids',v_item.cases),
   'event_feed_changed',
   'gos-id-live:'||v_item.game_id::text,
   true
  );
 END LOOP;
 RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION private.broadcast_game_event_invalidation() FROM PUBLIC,anon,authenticated;

-- Statement-level, not row-level: bulk assignments to 100 players send one notice.
-- Individual votes and derived authority rows intentionally do not broadcast:
-- 100 decisions must not fan out into 10,000 classroom WebSocket messages.
-- The teacher can inspect intermediate decisions on demand or via 3m recovery;
-- a completed outcome is delivered immediately to its actual participants.
DO $t$
DECLARE name text; op text; suffix text; transitions text;
BEGIN
 FOR name IN SELECT unnest(ARRAY[
  'event_assignments','event_collaboration_invites','event_cases',
  'event_case_outcomes','event_discussion_messages','event_case_routing'
 ]) LOOP
  FOR op IN SELECT unnest(CASE name
   WHEN 'event_discussion_messages' THEN ARRAY['INSERT']::text[]
   WHEN 'event_case_outcomes' THEN ARRAY['INSERT','UPDATE']::text[]
   ELSE ARRAY['INSERT','UPDATE','DELETE']::text[] END)
  LOOP
   suffix:=lower(op);
   transitions:=CASE op WHEN 'INSERT' THEN 'NEW TABLE AS new_event_rows'
     WHEN 'DELETE' THEN 'OLD TABLE AS old_event_rows'
     ELSE 'OLD TABLE AS old_event_rows NEW TABLE AS new_event_rows' END;
   EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I','event_push_'||name||'_'||suffix,name);
   EXECUTE format('CREATE TRIGGER %I AFTER %s ON public.%I REFERENCING %s FOR EACH STATEMENT EXECUTE FUNCTION private.broadcast_game_event_invalidation()',
     'event_push_'||name||'_'||suffix,op,name,transitions);
  END LOOP;
 END LOOP;
END $t$;

-- The UI needs only cases belonging to the student, or any data the teacher/
-- existing guest role is authorized to see. Keep group member rows together.
CREATE OR REPLACE FUNCTION public.get_event_workspace_projection(p_game_id uuid,p_include_ready_count boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 v_teacher boolean;
 v_full_view boolean;
 v_cases uuid[];
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_member(p_game_id) THEN
  RAISE EXCEPTION 'Нет доступа к игре.' USING ERRCODE='42501';
 END IF;
 v_teacher:=private.is_game_teacher(p_game_id);
 v_full_view:=v_teacher OR EXISTS(
  SELECT 1 FROM public.game_members gm WHERE gm.game_id=p_game_id AND gm.user_id=(SELECT auth.uid())
    AND gm.kind='observer' AND gm.roster_archived_at IS NULL);
 IF NOT v_full_view THEN
  SELECT coalesce(array_agg(DISTINCT x.case_id),ARRAY[]::uuid[]) INTO v_cases
  FROM (
   SELECT a.case_id FROM public.event_assignments a
    WHERE a.game_id=p_game_id AND a.recipient_id=(SELECT auth.uid())
   UNION
   SELECT i.case_id FROM public.event_collaboration_invites i
    WHERE i.game_id=p_game_id AND i.recipient_id=(SELECT auth.uid())
  ) x;
 END IF;
 RETURN jsonb_build_object(
  'assignments',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,game_id,recipient_id,status,created_at FROM public.event_assignments
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'decisions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,actor_id,choice,role_snapshot FROM public.event_decisions
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.case_id)
   FROM (SELECT case_id,winner,trust_delta,votes_count,assignments_count,media_post_id,requested_trust_delta,resolution_kind
   FROM public.event_case_outcomes WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'invitations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,inviter_id,recipient_id,status FROM public.event_collaboration_invites
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'authority',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.decision_id)
   FROM (SELECT decision_id,case_id,actor_id,authority_ok,lawful,strategy_point,role_snapshot,legal_basis
   FROM public.event_authority_evidence WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'ready_case_count',CASE WHEN p_include_ready_count AND v_teacher THEN
   (SELECT count(*) FROM public.event_cases WHERE game_id=p_game_id AND status='ready')
   ELSE NULL END
 );
END $fn$;


-- Preserve all existing assignment authorisation and audience rules;
-- replace only the per-recipient write loop with a single SQL INSERT.
CREATE OR REPLACE FUNCTION public.assign_event_case(p_case_id uuid, p_recipients uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;recipient uuid;n integer:=0;recipients uuid[];
begin
 select * into c from public.event_cases where id=p_case_id for update;
 if c.id is null or not private.is_game_teacher(c.game_id) then raise exception 'Требуются права преподавателя';end if;
 if c.status<>'ready' or exists(select 1 from public.event_case_outcomes where case_id=c.id)
 then raise exception 'Событие недоступно для назначения';end if;
 select array_agg(distinct v) into recipients from unnest(p_recipients) v where v is not null;
 if coalesce(cardinality(recipients),0)=0 then raise exception 'Выберите получателей';end if;
 if c.audience='single' and cardinality(recipients)<>1 then raise exception 'Выберите одного участника';end if;
 if c.audience='group' and cardinality(recipients) not between 2 and 3 then raise exception 'Выберите 2–3 участников';end if;
 if exists(select 1 from unnest(recipients) r where not exists(select 1 from public.game_members
  where game_id=c.game_id and user_id=r and kind='student')) then raise exception 'Получатель недоступен';end if;
 if c.audience='all' and cardinality(recipients)<>(select count(*) from public.game_members where game_id=c.game_id and kind='student')
 then raise exception 'Общее событие назначается всем участникам';end if;
 -- One set-based INSERT statement for all recipients: one trigger broadcast
 -- and one database round of assignment checks instead of up to 100 statements.
 INSERT INTO public.event_assignments(case_id,game_id,recipient_id,created_by)
 SELECT c.id,c.game_id,r.user_id,auth.uid()
 FROM unnest(recipients) AS r(user_id)
 ON CONFLICT(case_id,recipient_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 return n;
end;
$function$
;
