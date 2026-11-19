-- Crisis news: publish journalistically written articles, not a transcript.
-- Preserve authorizations, source-key idempotency and original crisis stage.
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
-- Repair the one already-published item in place, preserving post identity.
UPDATE public.political_posts SET title='Президент поручил начать переговоры на фоне массовых протестов',body='На фоне масштабных протестных акций Президент Российской Федерации Александр Разумовский поручил Правительству начать переговоры с коалицией «Общественный диалог» и другими представителями протестующих. Региональным властям рекомендовано временно приостановить спорные изменения тарифов и компенсаций до их публичного обсуждения. Первые результаты должны быть представлены в течение суток.

В качестве правового основания глава государства назвал статьи 80 и 90 Конституции Российской Федерации, а также напомнил о закреплённом статьёй 31 праве граждан на мирные собрания.

Для выполнения объявленных мер предполагается задействовать имеющиеся ресурсы Правительства, МВД и региональных органов власти. Дополнительные расходы пока не предусмотрены. Вместе с тем исполнение поручений осложняет отсутствие сформированных министерств: полноценная работа МВД пока не обеспечена.

«Президент слышит требования граждан и уважает их право на мирный протест. Власть готова к диалогу и поиску решений. Призываю всех соблюдать закон и сохранять спокойствие», — говорится в обращении главы государства.',updated_at=clock_timestamp()
WHERE id='14d4ef8c-4cad-491f-b391-a6d07fb8405e'::uuid AND game_id='068dac89-00ea-447a-96bf-0cb11d85014a'::uuid
 AND source_key='crisis-response:18177863-c210-456e-83dc-b6fbdf247665' AND deleted_at IS NULL;
