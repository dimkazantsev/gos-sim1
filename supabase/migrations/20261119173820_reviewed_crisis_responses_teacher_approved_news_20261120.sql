-- Each reviewed crisis response becomes exactly one teacher-approved news item.
-- No new tables, indexes, polling, or subscriptions.
ALTER TABLE public.crisis_responses
 ADD COLUMN IF NOT EXISTS published_post_id uuid,
 ADD COLUMN IF NOT EXISTS published_at timestamptz;
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
   status='reviewed',reviewed_at=now(),reviewed_by=v_uid,updated_at=now()
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
     resources=excluded.resources,public_message=excluded.public_message,status='submitted',
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
 v_title:=format('Кризис «%s»: представлен план %s',c.crisis_type,v_actor);
 v_body:=format('В рамках кризиса «%s» (этап %s) %s представил(а) предложения от имени %s.',
   c.crisis_type,c.stage_no,v_person,v_actor)
   ||E'\n\n' || 'Предложенные действия: ' || btrim(r.action_plan)
   || CASE WHEN nullif(btrim(coalesce(r.legal_basis,'')),'') IS NULL THEN '' ELSE E'\n\nПравовое обоснование участника: '||btrim(r.legal_basis) END
   || CASE WHEN nullif(btrim(coalesce(r.resources,'')),'') IS NULL THEN '' ELSE E'\n\nРесурсы и ограничения, указанные участником: '||btrim(r.resources) END
   || CASE WHEN nullif(btrim(coalesce(r.public_message,'')),'') IS NULL THEN '' ELSE E'\n\nПубличное обращение участника: '||btrim(r.public_message) END
   || E'\n\nОтвет преподавателя: '||btrim(r.teacher_note)
   || E'\n\nПредложения опубликованы после преподавательского разбора. Факт исполнения предложенных мер этой публикацией не подтверждается.';
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
REVOKE ALL ON FUNCTION public.publish_reviewed_crisis_response(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_reviewed_crisis_response(uuid) TO authenticated;
