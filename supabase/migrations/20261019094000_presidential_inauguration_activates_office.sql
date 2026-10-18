-- Президент вступает в должность после инаугурации, не после подсчёта ЦИК.
-- The election result is published first; legal powers activate at oath confirmation.
DO $patch$
DECLARE v_def text;v_begin int;v_end int;
BEGIN
 SELECT pg_get_functiondef('public.publish_presidential_cec_protocol(uuid,numeric,bigint,boolean,text)'::regprocedure)
 INTO v_def;
 v_begin:=position('-- End incompatible parliamentary offices' IN v_def);
 v_end:=position('INSERT INTO public.political_posts(' IN v_def);
 IF v_def IS NULL OR v_begin=0 OR v_end<=v_begin THEN
  RAISE EXCEPTION 'Existing CEC protocol publisher changed: abort safe upgrade';END IF;
 v_def:=substr(v_def,1,v_begin-1)
  ||'-- Президент избран, но вступит в должность только после подтверждённой инаугурации.'
  ||E'\n '||substr(v_def,v_end);
 EXECUTE v_def;
END;$patch$;

CREATE OR REPLACE FUNCTION public.confirm_presidential_inauguration(p_game_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_result presidential_election_settings%rowtype;
 v_c presidential_candidates%rowtype;v_ceremony presidential_inauguration%rowtype;
 v_post uuid;v_source text:='cec-presidential-inauguration:'||p_game_id::text;
BEGIN
 PERFORM private.require_active_presidential_teacher(p_game_id);
 IF NOT private.is_game_teacher(p_game_id) THEN RAISE EXCEPTION 'Только преподаватель подтверждает инаугурацию';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_source,0));
 SELECT id INTO v_post FROM public.political_posts WHERE game_id=p_game_id AND source_key=v_source;
 IF v_post IS NOT NULL THEN RETURN v_post;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.political_posts WHERE game_id=p_game_id
 AND source_key='cec-presidential-results:'||p_game_id::text AND status='published')
 THEN RAISE EXCEPTION 'Сначала опубликуйте официальный протокол ЦИК';END IF;
 SELECT * INTO v_result FROM public.presidential_election_settings WHERE game_id=p_game_id FOR UPDATE;
 IF v_result.status<>'finished' THEN RAISE EXCEPTION 'Итоги выборов ещё не завершены';END IF;
 SELECT * INTO v_ceremony FROM public.presidential_inauguration WHERE game_id=p_game_id;
 IF v_ceremony.scheduled_at IS NULL THEN RAISE EXCEPTION 'Сначала назначьте дату и время инаугурации';END IF;
 IF v_ceremony.scheduled_at>now() THEN RAISE EXCEPTION 'Инаугурация ещё не состоялась';END IF;
 SELECT * INTO v_c FROM public.presidential_candidates
 WHERE game_id=p_game_id AND id=(v_result.result->>'winner_id')::uuid
 AND registration_status='registered' AND archived_at IS NULL FOR UPDATE;
 IF v_c.user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.game_members
 WHERE game_id=p_game_id AND user_id=v_c.user_id AND kind='student' AND roster_archived_at IS NULL)
 THEN RAISE EXCEPTION 'Победитель не является действующим зарегистрированным участником';END IF;
 IF EXISTS(SELECT 1 FROM public.game_office_assignments WHERE game_id=p_game_id AND status='active'
  AND private.office_family(role_title)='president' AND user_id<>v_c.user_id)
 THEN RAISE EXCEPTION 'Должность Президента занята другим лицом';END IF;
 UPDATE public.game_office_assignments SET status='ended'
 WHERE game_id=p_game_id AND user_id=v_c.user_id AND status='active'
 AND private.office_family(role_title) IN ('gd','sf');
 IF NOT EXISTS(SELECT 1 FROM public.game_office_assignments WHERE game_id=p_game_id
 AND user_id=v_c.user_id AND status='active' AND private.office_family(role_title)='president')
 THEN
  INSERT INTO public.game_office_assignments(game_id,user_id,role_title,status,
   appointed_by,approved_by,legal_basis,educational_exception)
  VALUES(p_game_id,v_c.user_id,'Президент Российской Федерации','active',v_uid,v_uid,
   'Инаугурация по официально опубликованным итогам выборов Президента Российской Федерации',false);
 END IF;
 PERFORM private.sync_current_game_office(p_game_id,v_c.user_id,'Президент Российской Федерации');
 INSERT INTO public.political_posts(id,game_id,author_id,process_type,actor_key,actor_label,
  title,body,tags,status,source_key,context)
 VALUES(gen_random_uuid(),p_game_id,v_uid,'information','cec',
 'Центральная избирательная комиссия Российской Федерации',
 'Состоялась инаугурация Президента Российской Федерации',
 'В соответствии с официально опубликованными итогами выборов '
 ||v_c.display_name||' вступил(а) в должность Президента Российской Федерации '
 ||to_char(v_ceremony.scheduled_at AT TIME ZONE 'Asia/Barnaul','DD.MM.YYYY HH24:MI')
 ||'. С этого момента участнику предоставлены предусмотренные игрой полномочия Президента Российской Федерации.',
 ARRAY['цикрф_gpyasu','этап_gpyasu','ходигры_gpyasu','инаугурация'],
 'published',v_source,jsonb_build_object('official',true,'stage_no',7,
 'president_user_id',v_c.user_id,'winner_id',v_c.id,'inauguration_at',v_ceremony.scheduled_at))
 RETURNING id INTO v_post;
 RETURN v_post;
END;$fn$;
REVOKE ALL ON FUNCTION public.confirm_presidential_inauguration(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_presidential_inauguration(uuid) TO authenticated;
