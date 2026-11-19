-- Clarify crisis-news headline and authorship without invented completion or gendered inflection.
-- Preserves approved-post idempotency, teacher permission and original crisis stage.
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
 v_title:=format('Кризис «%s»: предложения участника — %s',c.crisis_type,v_person);
 v_body:=format('В рамках кризиса «%s» (этап %s) опубликован план реагирования. Автор предложения: %s. Указанная государственная роль: «%s».',
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
