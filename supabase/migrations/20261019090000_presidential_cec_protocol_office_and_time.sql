-- ГОС.ID: dated CEC calculation and one official immutable announcement.
-- The server, not the browser, composes every candidate's published percentages.
CREATE OR REPLACE FUNCTION private.compose_presidential_cec_protocol(
 p_game uuid,p_turnout numeric,p_voters bigint,p_violations boolean,p_note text
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE s presidential_election_settings%rowtype;
 v_c jsonb;v_r jsonb;v_program text:='';v_campaign text:='';v_rating text:='';
 v_poll text:='';v_results text:='';v_runoff text:='';v_winner text;v_day date;
 v_jury int;v_parts int;v_text text;v_venue text;v_inauguration timestamptz;
BEGIN
 SELECT * INTO s FROM public.presidential_election_settings WHERE game_id=p_game;
 IF s.status<>'finished' OR s.result->'calculation' IS NULL THEN
  RAISE EXCEPTION 'ЦИК сначала должна завершить расчёт выборов';END IF;
 SELECT voting_day INTO v_day FROM public.presidential_election_schedule WHERE game_id=p_game;
 IF v_day IS NULL THEN RAISE EXCEPTION 'Совет Федерации ещё не назначил выборы';END IF;
 IF p_turnout IS NOT NULL AND (p_turnout<0 OR p_turnout>100) THEN RAISE EXCEPTION 'Явка должна быть от 0 до 100 процентов';END IF;
 IF p_voters IS NOT NULL AND p_voters<0 THEN RAISE EXCEPTION 'Число избирателей не может быть отрицательным';END IF;
 v_jury:=s.jury_size;v_parts:=CASE WHEN s.poll_enabled THEN 4 ELSE 3 END;
 SELECT display_name INTO v_winner FROM public.presidential_candidates WHERE id=(s.result->>'winner_id')::uuid AND game_id=p_game;
 IF v_winner IS NULL THEN RAISE EXCEPTION 'Не удалось определить победителя по сохранённым итогам';END IF;
 FOR v_c IN SELECT value FROM jsonb_array_elements(s.result->'calculation'->'rows') LOOP
  IF (s.result->>'round')::int=1 THEN
   v_program:=v_program||E'\n• '||(v_c->>'name')||' — '||round((v_c->>'program_pct')::numeric,4)||'%';
   v_campaign:=v_campaign||E'\n• '||(v_c->>'name')||' — '||round((v_c->>'campaign_pct')::numeric,4)||'%';
   v_rating:=v_rating||E'\n• '||(v_c->>'name')||' — '||round((v_c->>'game_pct')::numeric,4)||'%';
   IF s.poll_enabled THEN v_poll:=v_poll||E'\n• '||(v_c->>'name')||' — '||round((v_c->>'poll_pct')::numeric,4)||'%';END IF;
  ELSE
   v_runoff:=v_runoff||E'\n• '||(v_c->>'name')||': первый тур '
    ||round((v_c->>'first_pct')::numeric,4)||'% + голоса ППС '
    ||round((v_c->>'teacher_runoff_pct')::numeric,4)||'%, итог / 2 = '
    ||round((v_c->>'result_pct')::numeric,4)||'%';
  END IF;
  v_results:=v_results||E'\n• '||(v_c->>'name')||' — '||round((v_c->>'result_pct')::numeric,4)||'%';
 END LOOP;
 v_text:='Центральная избирательная комиссия Российской Федерации подвела итоги выборов Президента Российской Федерации, состоявшихся '
  ||to_char(v_day,'DD.MM.YYYY')||'.'
  ||CASE WHEN p_turnout IS NULL THEN '' ELSE E'\nЯвка: '||p_turnout||'%.' END
  ||CASE WHEN p_voters IS NULL THEN '' ELSE E'\nПроголосовали: '||p_voters||' избирателей.' END
  ||CASE WHEN p_violations IS NULL THEN '' WHEN p_violations THEN E'\nЗафиксированы нарушения, которые требуют отдельного разъяснения ЦИК.' ELSE E'\nНарушений, повлиявших на итог, по данным ЦИК не зарегистрировано.' END
  ||E'\n\nИТОГИ ВЫБОРОВ ПРЕЗИДЕНТА РОССИЙСКОЙ ФЕДЕРАЦИИ'
  ||E'\nУтверждённая студентами избирательная система: '||
   CASE s.system_type WHEN 'relative' THEN 'Относительное большинство'
   WHEN 'absolute' THEN 'Абсолютное большинство' WHEN 'qualified' THEN 'Квалифицированное большинство (порог '||s.threshold_pct||'%)'
   ELSE 'Преференциальная система' END||'.';
 IF (s.result->>'round')::int=1 THEN
  v_text:=v_text||E'\n\nФормула итогового процента = (Программа ППС + Агитация ППС + Рейтинг игры'
   ||CASE WHEN s.poll_enabled THEN ' + Социологический опрос' ELSE '' END||') / '||v_parts||'.'
   ||E'\n\nГолосование ППС: анализ документов и программ ('||v_jury||' голосов — 100%):'||v_program
   ||E'\n\nГолосование ППС: анализ агитации ('||v_jury||' голосов — 100%):'||v_campaign
   ||E'\n\nИгровой рейтинг (баллы кандидата / сумма баллов кандидатов × 100):'||v_rating;
  IF s.poll_enabled THEN v_text:=v_text||E'\n\nСоциологический опрос:'||v_poll;END IF;
  v_text:=v_text||E'\n\nИтог по формуле (с учётом зафиксированных штрафов и партийных модификаторов):'||v_results;
 ELSE
  v_text:=v_text||E'\n\nВторой тур: (непересчитанный итог первого тура + новые голоса ППС) / 2.'
   ||v_runoff||E'\n\nИтог второго тура:'||v_results;
 END IF;
 SELECT scheduled_at,venue INTO v_inauguration,v_venue FROM public.presidential_inauguration WHERE game_id=p_game;
 v_text:=v_text||E'\n\nПобедитель выборов: '||v_winner||'.'
  ||E'\nПосле опубликования результатов проводится инаугурация в присутствии Председателя Совета Федерации, Председателя Государственной Думы и Председателя Конституционного Суда Российской Федерации.'
  ||CASE WHEN v_inauguration IS NOT NULL THEN E'\nДата инаугурации: '||to_char(v_inauguration AT TIME ZONE 'Asia/Barnaul','DD.MM.YYYY HH24:MI')||'.' ELSE '' END
  ||CASE WHEN nullif(v_venue,'') IS NOT NULL THEN E'\nМесто: '||v_venue||'.' ELSE '' END;
 IF nullif(trim(coalesce(p_note,'')),'') IS NOT NULL
 THEN v_text:=v_text||E'\n\nДополнительное разъяснение ЦИК: '||left(trim(p_note),4000);END IF;
 RETURN v_text||E'\n\n#цикрф_gpyasu #этап_gpyasu #ходигры_gpyasu #итогиэтапа_gpyasu';
END;$fn$;
REVOKE ALL ON FUNCTION private.compose_presidential_cec_protocol(uuid,numeric,bigint,boolean,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.preview_presidential_cec_protocol(
 p_game_id uuid,p_turnout_pct numeric DEFAULT NULL,p_voter_count bigint DEFAULT NULL,
 p_major_violations boolean DEFAULT NULL,p_note text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
BEGIN
 PERFORM private.require_active_presidential_teacher(p_game_id);
 IF NOT private.is_game_teacher(p_game_id) THEN RAISE EXCEPTION 'Только ЦИК может составить протокол';END IF;
 RETURN private.compose_presidential_cec_protocol(p_game_id,p_turnout_pct,p_voter_count,p_major_violations,p_note);
END;$fn$;

CREATE OR REPLACE FUNCTION public.publish_presidential_cec_protocol(
 p_game_id uuid,p_turnout_pct numeric,p_voter_count bigint,p_major_violations boolean,p_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_s presidential_election_settings%rowtype;v_candidate presidential_candidates%rowtype;
 v_doc text;v_post uuid;v_source text:='cec-presidential-results:'||p_game_id::text;
 v_schedule date;v_local timestamptz;v_state text;
BEGIN
 PERFORM private.require_active_presidential_teacher(p_game_id);
 IF NOT private.is_game_teacher(p_game_id) THEN RAISE EXCEPTION 'Публикация итогов принадлежит ЦИК';END IF;
 IF p_turnout_pct IS NULL OR p_turnout_pct NOT BETWEEN 0 AND 100 OR p_voter_count IS NULL OR p_voter_count<1
 OR p_major_violations IS NULL THEN RAISE EXCEPTION 'Укажите фактическую явку, число проголосовавших и сведения о нарушениях';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_source,0));
 SELECT id INTO v_post FROM public.political_posts WHERE game_id=p_game_id AND source_key=v_source;
 IF v_post IS NOT NULL THEN RETURN v_post; END IF;
 SELECT * INTO v_s FROM public.presidential_election_settings WHERE game_id=p_game_id FOR UPDATE;
 IF v_s.status<>'finished' THEN RAISE EXCEPTION 'Результаты ещё не утверждены ЦИК';END IF;
 SELECT voting_day INTO v_schedule FROM public.presidential_election_schedule WHERE game_id=p_game_id;
 IF v_schedule IS NULL THEN RAISE EXCEPTION 'Выборы не назначены Советом Федерации';END IF;
 IF now() AT TIME ZONE 'Asia/Barnaul' < v_schedule::timestamp+interval '20 hours'
 THEN RAISE EXCEPTION 'Публикация итогов возможна только после 20:00 третьего дня выборов';END IF;
 SELECT * INTO v_candidate FROM public.presidential_candidates
 WHERE id=(v_s.result->>'winner_id')::uuid AND game_id=p_game_id AND registration_status='registered' AND archived_at IS NULL
 FOR UPDATE;
 IF v_candidate.id IS NULL OR v_candidate.user_id IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.game_members gm WHERE gm.game_id=p_game_id AND gm.user_id=v_candidate.user_id
 AND gm.kind='student' AND gm.roster_archived_at IS NULL)
 THEN RAISE EXCEPTION 'Победителем может быть назначен только действующий зарегистрированный кандидат';END IF;
 IF EXISTS(SELECT 1 FROM public.game_office_assignments a
  WHERE a.game_id=p_game_id AND a.status='active' AND private.office_family(a.role_title)='president'
  AND a.user_id<>v_candidate.user_id)
 THEN RAISE EXCEPTION 'Должность Президента уже занята. Требуется разрешить конфликт назначений';END IF;
 v_doc:=private.compose_presidential_cec_protocol(p_game_id,p_turnout_pct,p_voter_count,p_major_violations,p_note);
 -- End incompatible parliamentary offices while retaining their historical appointment record.
 UPDATE public.game_office_assignments SET status='ended'
 WHERE game_id=p_game_id AND user_id=v_candidate.user_id AND status='active'
 AND private.office_family(role_title) IN ('gd','sf');
 IF NOT EXISTS(SELECT 1 FROM public.game_office_assignments
 WHERE game_id=p_game_id AND user_id=v_candidate.user_id AND status='active'
 AND private.office_family(role_title)='president') THEN
  INSERT INTO public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
  VALUES(p_game_id,v_candidate.user_id,'Президент Российской Федерации','active',v_uid,v_uid,
   'Официально опубликованные результаты выборов Президента Российской Федерации',false);
 END IF;
 PERFORM private.sync_current_game_office(p_game_id,v_candidate.user_id,'Президент Российской Федерации');
 INSERT INTO public.political_posts(id,game_id,author_id,process_type,actor_key,actor_label,
 title,body,tags,internal_view,status,source_key,context)
 VALUES(gen_random_uuid(),p_game_id,v_uid,'information','cec',
 'Центральная избирательная комиссия Российской Федерации',
 'ЦИК России объявила итоги выборов Президента Российской Федерации',v_doc,
 ARRAY['цикрф_gpyasu','этап_gpyasu','ходигры_gpyasu','итогиэтапа_gpyasu'],
 'stages','published',v_source,jsonb_build_object('automatic',false,'official',true,
 'stage_no',7,'winner_id',v_candidate.id,'president_user_id',v_candidate.user_id,
 'election_day',v_schedule,'turnout_pct',p_turnout_pct,'voter_count',p_voter_count))
 RETURNING id INTO v_post;
 RETURN v_post;
END;$fn$;

-- Ensure the existing round finalizer cannot run before the election day begins.
-- Preserve the established author formula, thresholds, and runoff algorithm intact.
DO $patch$
DECLARE v_definition text;v_anchor text:='perform private.require_active_presidential_teacher(p_game_id);';
BEGIN
 SELECT pg_get_functiondef('public.finalize_presidential_round(uuid,integer)'::regprocedure) INTO v_definition;
 IF v_definition IS NULL OR position(v_anchor IN v_definition)=0
 THEN RAISE EXCEPTION 'Presidential finalizer changed: inspect it before migration';END IF;
 v_definition:=replace(v_definition,v_anchor,
 'if not exists(select 1 from public.presidential_student_system_result where game_id=p_game_id)
 then raise exception ''Дождитесь решения студентов на шестом этапе'';end if;
 if not exists(select 1 from public.presidential_election_schedule where game_id=p_game_id
 and now() at time zone ''Asia/Barnaul'' >= voting_day::timestamp+interval ''20 hours'')
 then raise exception ''Расчёт итогов возможен не ранее 20:00 третьего дня выборов'';end if;
 '||v_anchor);
 EXECUTE v_definition;
END;$patch$;
REVOKE ALL ON FUNCTION public.preview_presidential_cec_protocol(uuid,numeric,bigint,boolean,text),
 public.publish_presidential_cec_protocol(uuid,numeric,bigint,boolean,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_presidential_cec_protocol(uuid,numeric,bigint,boolean,text),
 public.publish_presidential_cec_protocol(uuid,numeric,bigint,boolean,text) TO authenticated;
