
-- ГОС.ID: исправление регистрации на этапе 5 и закрытый Совет Государственной Думы.
-- Типизированные проверки НПА не должны компилироваться на строках других таблиц.
CREATE OR REPLACE FUNCTION private.guard_stage_document_hold_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE uid uuid:=auth.uid();v_game uuid;v_stage integer;
BEGIN
 IF uid IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='formal_documents' THEN
  IF TG_OP='UPDATE' THEN
   IF private.stage4_legal_act_can_finalize(OLD,NEW,uid) THEN RETURN NEW; END IF;
   IF private.can_reapprove_returned_gd_minutes(OLD,NEW,uid) THEN RETURN NEW; END IF;
  END IF;
 END IF;
 v_game:=NEW.game_id;v_stage:=NEW.stage_no;
 IF NOT private.is_game_teacher(v_game)
    AND private.has_prior_stage_document_hold(v_game,uid,v_stage) THEN
    IF TG_TABLE_NAME='formal_documents' THEN
     IF (TG_OP='INSERT' OR (OLD.game_id=NEW.game_id AND OLD.stage_no=NEW.stage_no
          AND OLD.doc_type=NEW.doc_type AND OLD.subject_key=NEW.subject_key
          AND OLD.metadata->>'template_key'=NEW.metadata->>'template_key'))
       AND private.can_remediate_stage_final_document(
         NEW.game_id,NEW.stage_no,uid,NEW.doc_type,NEW.subject_key,NEW.metadata)
     THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'Следующий этап недоступен: завершите обязательные итоговые документы предыдущего этапа'
      USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$function$;
REVOKE ALL ON FUNCTION private.guard_stage_document_hold_write() FROM PUBLIC,anon,authenticated;

-- Не создаём публичный канал или второй канал для повторной синхронизации.
CREATE UNIQUE INDEX IF NOT EXISTS gd_council_one_private_chat_per_game
 ON public.chat_channels(game_id) WHERE kind='private' AND name='Совет ГД';

CREATE OR REPLACE FUNCTION private.sync_gd_council_chat(p_game uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_channel uuid;v_completed boolean;
BEGIN
 IF p_game IS NULL THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gd-council-chat:'||p_game::text,0));
 SELECT EXISTS(SELECT 1 FROM public.game_stages s
  WHERE s.game_id=p_game AND s.stage_no=4 AND s.status='completed')
 INTO v_completed;
 SELECT id INTO v_channel FROM public.chat_channels
  WHERE game_id=p_game AND kind='private' AND name='Совет ГД' LIMIT 1;
 IF NOT v_completed THEN
  IF v_channel IS NOT NULL THEN
   DELETE FROM public.channel_members WHERE channel_id=v_channel;
  END IF;
  RETURN;
 END IF;
 IF v_channel IS NULL THEN
  INSERT INTO public.chat_channels(game_id,kind,name,created_by)
   VALUES(p_game,'private','Совет ГД',NULL)
   ON CONFLICT DO NOTHING RETURNING id INTO v_channel;
  IF v_channel IS NULL THEN
   SELECT id INTO v_channel FROM public.chat_channels
   WHERE game_id=p_game AND kind='private' AND name='Совет ГД' LIMIT 1;
  END IF;
 END IF;
 IF v_channel IS NULL THEN RAISE EXCEPTION 'Не удалось создать закрытый Совет ГД'; END IF;
 WITH desired AS (
  SELECT gm.user_id FROM public.game_members gm
   JOIN public.game_parties p ON p.game_id=gm.game_id AND p.leader_user_id=gm.user_id
  WHERE gm.game_id=p_game AND gm.kind='student'
   AND gm.roster_archived_at IS NULL AND p.registration_status='registered'
  UNION
  SELECT gm.user_id FROM public.game_members gm
   JOIN public.game_office_assignments a ON a.game_id=gm.game_id AND a.user_id=gm.user_id
  WHERE gm.game_id=p_game AND gm.kind='student' AND gm.roster_archived_at IS NULL
   AND a.status='active'
   AND (lower(btrim(a.role_title))='председатель государственной думы'
     OR lower(btrim(a.role_title)) LIKE 'заместитель председателя государственной думы%')
 )
 INSERT INTO public.channel_members(channel_id,user_id)
 SELECT v_channel,d.user_id FROM desired d ON CONFLICT DO NOTHING;

 DELETE FROM public.channel_members cm
 WHERE cm.channel_id=v_channel
   AND NOT EXISTS(
    SELECT 1 FROM public.game_members gm
    WHERE gm.game_id=p_game AND gm.user_id=cm.user_id
     AND gm.kind='student' AND gm.roster_archived_at IS NULL
     AND (
      EXISTS(SELECT 1 FROM public.game_parties p
        WHERE p.game_id=p_game AND p.leader_user_id=gm.user_id
          AND p.registration_status='registered')
      OR EXISTS(SELECT 1 FROM public.game_office_assignments a
        WHERE a.game_id=p_game AND a.user_id=gm.user_id
          AND a.status='active'
          AND (lower(btrim(a.role_title))='председатель государственной думы'
            OR lower(btrim(a.role_title)) LIKE 'заместитель председателя государственной думы%'))
     )
   );
END;$function$;
REVOKE ALL ON FUNCTION private.sync_gd_council_chat(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.sync_gd_council_chat_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_game uuid;
BEGIN
 IF TG_OP='DELETE' THEN v_game:=OLD.game_id;
 ELSE v_game:=NEW.game_id; END IF;
 IF TG_TABLE_NAME='game_stages' THEN
  IF NEW.stage_no=4 THEN PERFORM private.sync_gd_council_chat(v_game); END IF;
 ELSE
  PERFORM private.sync_gd_council_chat(v_game);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;$function$;
REVOKE ALL ON FUNCTION private.sync_gd_council_chat_trigger() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS gd_council_chat_stage4 ON public.game_stages;
CREATE TRIGGER gd_council_chat_stage4 AFTER UPDATE OF status ON public.game_stages
 FOR EACH ROW EXECUTE FUNCTION private.sync_gd_council_chat_trigger();
DROP TRIGGER IF EXISTS gd_council_chat_party ON public.game_parties;
CREATE TRIGGER gd_council_chat_party AFTER INSERT OR DELETE OR UPDATE OF leader_user_id,registration_status
 ON public.game_parties FOR EACH ROW EXECUTE FUNCTION private.sync_gd_council_chat_trigger();
DROP TRIGGER IF EXISTS gd_council_chat_office ON public.game_office_assignments;
CREATE TRIGGER gd_council_chat_office AFTER INSERT OR DELETE OR UPDATE OF user_id,role_title,status
 ON public.game_office_assignments FOR EACH ROW EXECUTE FUNCTION private.sync_gd_council_chat_trigger();
DROP TRIGGER IF EXISTS gd_council_chat_membership ON public.game_members;
CREATE TRIGGER gd_council_chat_membership AFTER UPDATE OF kind,roster_archived_at
 ON public.game_members FOR EACH ROW EXECUTE FUNCTION private.sync_gd_council_chat_trigger();

-- Сервисный реестр не публикуется в Data API, позволяет не повторять историческую доставку.
CREATE TABLE IF NOT EXISTS private.gd_council_chat_document_delivery (
 game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
 document_id uuid NOT NULL REFERENCES public.formal_documents(id) ON DELETE CASCADE,
 message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
 last_arrival_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(game_id,document_id)
);
CREATE INDEX IF NOT EXISTS gd_council_delivery_document_idx ON private.gd_council_chat_document_delivery(document_id);
CREATE INDEX IF NOT EXISTS gd_council_delivery_message_idx ON private.gd_council_chat_document_delivery(message_id);
ALTER TABLE private.gd_council_chat_document_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.gd_council_chat_document_delivery FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.post_gd_council_document_arrival(
 p_game uuid,p_document uuid,p_title text,p_registry text,p_backfill boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE v_channel uuid;v_message uuid;v_text text;
BEGIN
 PERFORM private.sync_gd_council_chat(p_game);
 SELECT id INTO v_channel FROM public.chat_channels
  WHERE game_id=p_game AND kind='private' AND name='Совет ГД' LIMIT 1;
 IF v_channel IS NULL THEN RETURN; END IF;
 IF p_backfill AND EXISTS(SELECT 1 FROM private.gd_council_chat_document_delivery
  WHERE game_id=p_game AND document_id=p_document) THEN RETURN; END IF;
 v_text:='В Совет ГД поступил документ «'||left(coalesce(nullif(btrim(p_title),''),'Без названия'),220)||'»'
  ||CASE WHEN nullif(btrim(coalesce(p_registry,'')),'') IS NOT NULL
   THEN ' (№ '||left(p_registry,100)||')' ELSE '' END
  ||'. Документ ожидает рассмотрения в реестре НПА.';
 INSERT INTO public.chat_messages(game_id,channel_id,author_id,kind,text)
  VALUES(p_game,v_channel,NULL,'system',v_text) RETURNING id INTO v_message;
 INSERT INTO private.gd_council_chat_document_delivery(game_id,document_id,message_id,last_arrival_at)
  VALUES(p_game,p_document,v_message,clock_timestamp())
  ON CONFLICT(game_id,document_id) DO UPDATE
  SET message_id=excluded.message_id,last_arrival_at=excluded.last_arrival_at;
END;$function$;
REVOKE ALL ON FUNCTION private.post_gd_council_document_arrival(uuid,uuid,text,text,boolean)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.notify_gd_council_document_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
BEGIN
 IF NEW.current_owner_key IS DISTINCT FROM 'gd_council' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.current_owner_key IS NOT DISTINCT FROM NEW.current_owner_key THEN RETURN NEW; END IF;
 END IF;
 PERFORM private.post_gd_council_document_arrival(
  NEW.game_id,NEW.id,NEW.title,NEW.registry_no,false);
 RETURN NEW;
END;$function$;
REVOKE ALL ON FUNCTION private.notify_gd_council_document_trigger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS gd_council_chat_document_arrival ON public.formal_documents;
CREATE TRIGGER gd_council_chat_document_arrival
 AFTER INSERT OR UPDATE OF current_owner_key,current_step,status_code,workflow_steps
 ON public.formal_documents FOR EACH ROW
 EXECUTE FUNCTION private.notify_gd_council_document_trigger();

-- Закрытые беседы Совета ГД видны всем его членам, не только двум участникам.
CREATE OR REPLACE FUNCTION public.get_my_chat_overview(p_game_id uuid)
 RETURNS TABLE(channel_id uuid, last_message_at timestamp with time zone, last_message_text text, last_message_author_id uuid, unread_count bigint, mention_count bigint, last_sent_at timestamp with time zone, last_read_at timestamp with time zone, pinned_at timestamp with time zone, pinned_rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 with accessible as (
  select c.id,c.created_at
  from public.chat_channels c
  where c.game_id=p_game_id
    and private.can_access_channel(c.id)
    and (c.kind<>'private' or (c.kind='private' and c.name='Совет ГД')
      or (select count(*) from public.channel_members cm where cm.channel_id=c.id)=2)
 ), state as (
  select s.* from public.chat_channel_state s
  where s.game_id=p_game_id and s.user_id=(select auth.uid())
 )
 select a.id,
   lm.created_at,lm.text,lm.author_id,
   (select count(*) from public.chat_messages m
      where m.channel_id=a.id and m.author_id is distinct from (select auth.uid())
        and m.created_at>coalesce(s.last_read_at,'epoch'::timestamptz)) as unread_count,
   (select count(*) from public.chat_mentions mn
      where mn.channel_id=a.id and mn.mentioned_user_id=(select auth.uid()) and mn.read_at is null) as mention_count,
   s.last_sent_at,s.last_read_at,s.pinned_at,s.pinned_rank
 from accessible a
 left join state s on s.channel_id=a.id
 left join lateral (
  select m.created_at,m.text,m.author_id from public.chat_messages m
  where m.channel_id=a.id order by m.created_at desc limit 1
 ) lm on true
 order by
   case when s.pinned_at is not null then 0 else 1 end,
   s.pinned_rank nulls last,
   lm.created_at desc nulls last,
   a.created_at desc;
$function$;


-- Сохранённые игры: Совет ГД появляется после уже завершённого этапа 4,
-- а документы, которые сейчас находятся на его рассмотрении, объявляются один раз.
DO $backfill$
DECLARE v_game record;v_doc record;
BEGIN
 FOR v_game IN SELECT game_id FROM public.game_stages WHERE stage_no=4 AND status='completed'
 LOOP
  PERFORM private.sync_gd_council_chat(v_game.game_id);
  FOR v_doc IN SELECT id,title,registry_no FROM public.formal_documents
    WHERE game_id=v_game.game_id AND current_owner_key='gd_council'
  LOOP
   PERFORM private.post_gd_council_document_arrival(
    v_game.game_id,v_doc.id,v_doc.title,v_doc.registry_no,true);
  END LOOP;
 END LOOP;
END;$backfill$;
