-- Teacher rejects a proposed news publication without deleting the official
-- crisis decision or disrupting its reviewed status. Resubmission or saving
-- the teacher's revised answer clears rejection for a subsequent approval.
-- Single indexed mutation. No new subscriptions or polling.
ALTER TABLE public.crisis_responses ADD COLUMN IF NOT EXISTS publication_rejected_at timestamptz;
CREATE OR REPLACE FUNCTION public.review_crisis_response(p_response_id uuid, p_teacher_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r public.crisis_responses%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into r from public.crisis_responses where id=p_response_id for update;
 if r.id is null then raise exception 'Crisis response not found'; end if;
 if not private.is_game_teacher(r.game_id) then raise exception 'Teacher access required'; end if;
 if r.published_post_id is not null then raise exception 'Новость уже опубликована; ответ больше не изменяется'; end if;
 if length(btrim(coalesce(p_teacher_note,'')))<10 then
   raise exception 'Укажите содержательный ответ преподавателя (не менее 10 символов)';
 end if;
 update public.crisis_responses set teacher_note=nullif(trim(coalesce(p_teacher_note,'')),''),
   status='reviewed',publication_rejected_at=null,reviewed_at=now(),reviewed_by=v_uid,updated_at=now()
 where id=r.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_crisis_response(p_crisis_id uuid, p_action_plan text, p_legal_basis text DEFAULT NULL::text, p_resources text DEFAULT NULL::text, p_public_message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());c public.game_crises%rowtype;v_role text;v_id uuid;v_published uuid;
begin
 select * into c from public.game_crises where id=p_crisis_id;
 if c.id is null then raise exception 'Crisis not found'; end if;
 if v_uid is null or not private.is_game_member(c.game_id) then raise exception 'Game access required'; end if;
 if c.status<>'active' then raise exception 'Crisis is already resolved'; end if;
 if length(trim(coalesce(p_action_plan,'')))<20 then raise exception 'Action plan is too short'; end if;
 select published_post_id into v_published from public.crisis_responses
   where crisis_id=c.id and user_id=v_uid for update;
 if v_published is not null then
   raise exception 'Решение уже опубликовано как новость; изменить его нельзя';
 end if;
 select role_title into v_role from public.game_members where game_id=c.game_id and user_id=v_uid;

 insert into public.crisis_responses(crisis_id,game_id,user_id,role_title,action_plan,legal_basis,resources,public_message)
 values(c.id,c.game_id,v_uid,v_role,trim(p_action_plan),nullif(trim(coalesce(p_legal_basis,'')),''),nullif(trim(coalesce(p_resources,'')),''),nullif(trim(coalesce(p_public_message,'')),''))
 on conflict(crisis_id,user_id) do update
 set role_title=excluded.role_title,action_plan=excluded.action_plan,legal_basis=excluded.legal_basis,
     resources=excluded.resources,public_message=excluded.public_message,status='submitted',publication_rejected_at=null,
     updated_at=now(),teacher_note=null,reviewed_at=null,reviewed_by=null
 returning id into v_id;
 return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.publish_reviewed_crisis_response(p_response_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
 r public.crisis_responses%ROWTYPE;
 c public.game_crises%ROWTYPE;
 v_person text;
 v_actor text;
 v_title text;
 v_body text;
 v_post uuid;
 v_key text;
BEGIN
 SELECT * INTO r FROM public.crisis_responses WHERE id=p_response_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Решение участника не найдено'; END IF;
 IF NOT private.is_game_teacher(r.game_id) THEN
   RAISE EXCEPTION 'Подтвердить публикацию может только преподаватель' USING ERRCODE='42501';
 END IF;
 IF r.published_post_id IS NOT NULL THEN RETURN r.published_post_id; END IF;
 IF r.publication_rejected_at IS NOT NULL THEN
   RAISE EXCEPTION 'Публикация отклонена. Для повторного рассмотрения сохраните ответ заново'
   USING ERRCODE='23514';
 END IF;
 IF r.status<>'reviewed' OR length(btrim(coalesce(r.teacher_note,'')))<10
    OR r.reviewed_by IS NULL THEN
    RAISE EXCEPTION 'Сначала сохраните содержательный ответ преподавателя';
 END IF;
 SELECT * INTO c FROM public.game_crises
 WHERE id=r.crisis_id AND game_id=r.game_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Связанный кризис не найден'; END IF;
 SELECT nullif(btrim(full_name),'') INTO v_person
 FROM public.game_members WHERE game_id=r.game_id AND user_id=r.user_id;
 v_person:=coalesce(v_person,'Участник');
 v_actor:=coalesce(nullif(btrim(r.role_title),''),'участника');
 -- Editorial news, not a classroom transcript. Preserve speaker statements as
 -- attributed statements; do not infer that announced actions are completed.
 v_title:=CASE WHEN lower(v_actor) LIKE '%президент%'
  THEN format('Президент представил меры реагирования на кризис «%s»',c.crisis_type)
  ELSE format('Кризис «%s»: представлены меры %s',c.crisis_type,v_actor)
 END;
 v_body:=format('На фоне кризиса «%s» представлен план реагирования, подготовленный %s (%s).',c.crisis_type,v_person,v_actor)
   || E'\n\n' || 'Среди заявленных мер: «' || btrim(r.action_plan) || '».'
   || CASE WHEN nullif(btrim(coalesce(r.legal_basis,'')),'') IS NULL THEN ''
     ELSE E'\n\n' || 'В качестве правовой основы названы следующие положения: «' || btrim(r.legal_basis) || '».'
     END
   || CASE WHEN nullif(btrim(coalesce(r.resources,'')),'') IS NULL THEN ''
     ELSE E'\n\n' || 'Для реализации мер предполагается задействовать имеющиеся ресурсы. В плане отмечено: «' || btrim(r.resources) || '».'
     END
   || CASE WHEN nullif(btrim(coalesce(r.public_message,'')),'') IS NULL THEN ''
     ELSE E'\n\n' || 'В обращении к гражданам говорится: «' || btrim(r.public_message) || '».'
     END
   || E'\n\n' || 'Вместе с тем сохраняются обстоятельства, которые могут повлиять на исполнение заявленных мер: '
   || btrim(r.teacher_note);
 v_key:='crisis-response:'||r.id::text;
 INSERT INTO public.political_posts(game_id,author_id,process_type,actor_key,actor_label,
   title,body,tags,source_key,context)
 VALUES(r.game_id,auth.uid(),'news','media','Республиканский обозреватель',
   v_title,v_body,ARRAY['кризис','решения','разбор'],v_key,
   jsonb_build_object('source_table','crisis_responses','crisis_response_id',r.id,
     'crisis_id',r.crisis_id,'stage_no',c.stage_no,'stage_source','explicit',
     'teacher_answer',r.teacher_note,'reviewed_by',r.reviewed_by,
     'approved_by',auth.uid(),'editorial_verified',true))
 ON CONFLICT(game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING
 RETURNING id INTO v_post;
 IF v_post IS NULL THEN
   SELECT id INTO v_post FROM public.political_posts
   WHERE game_id=r.game_id AND source_key=v_key AND deleted_at IS NULL;
   IF v_post IS NULL THEN RAISE EXCEPTION 'Новость уже существовала, но была удалена'; END IF;
 END IF;
 UPDATE public.crisis_responses SET published_post_id=v_post,published_at=clock_timestamp()
 WHERE id=r.id;
 RETURN v_post;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reject_reviewed_crisis_news(p_response_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE r public.crisis_responses%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.crisis_responses WHERE id=p_response_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Решение не найдено'; END IF;
 IF NOT private.is_game_teacher(r.game_id) THEN
   RAISE EXCEPTION 'Только преподаватель может отклонить публикацию' USING ERRCODE='42501';
 END IF;
 IF r.published_post_id IS NOT NULL THEN
   RAISE EXCEPTION 'Опубликованную новость нельзя отклонить как черновик' USING ERRCODE='23514';
 END IF;
 IF r.status<>'reviewed' OR r.reviewed_by IS NULL THEN
   RAISE EXCEPTION 'Сначала сохраните ответ преподавателя' USING ERRCODE='23514';
 END IF;
 IF r.publication_rejected_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.crisis_responses SET publication_rejected_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=r.id;
END
$function$
;
REVOKE ALL ON FUNCTION public.reject_reviewed_crisis_news(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reject_reviewed_crisis_news(uuid) TO authenticated;
