-- ГОС.ID · Этап 7. Процентный рейтинг кандидатов и опрос строго по решению Этапа 6.
-- Старые сырые баллы остаются в game_rating_points; завершённые протоколы не меняются.
ALTER TABLE public.presidential_scorecards
 ADD COLUMN IF NOT EXISTS game_rating_manual_pct numeric
 CONSTRAINT presidential_scorecards_manual_pct_range
 CHECK (game_rating_manual_pct BETWEEN 0 AND 100);

-- Новый, отдельно именованный метод: прежний RPC для исторических числовых баллов сохраняется.
CREATE OR REPLACE FUNCTION public.set_presidential_rules_percentage(
 p_candidate_id uuid,p_game_pct numeric,p_poll_pct numeric DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
DECLARE
 c public.presidential_candidates%rowtype;
 s public.presidential_election_settings%rowtype;
 v_poll boolean:=false;
BEGIN
 PERFORM private.require_active_presidential_teacher(
   (SELECT game_id FROM public.presidential_candidates WHERE id=p_candidate_id)
 );
 SELECT * INTO c FROM public.presidential_candidates
 WHERE id=p_candidate_id AND archived_at IS NULL;
 IF c.id IS NULL OR auth.uid() IS NULL OR NOT private.is_game_teacher(c.game_id)
 THEN RAISE EXCEPTION 'Только преподаватель может вносить рейтинг кандидата'; END IF;
 SELECT * INTO s FROM public.presidential_election_settings WHERE game_id=c.game_id FOR UPDATE;
 IF s.game_id IS NULL OR s.status NOT IN ('setup','round1')
 THEN RAISE EXCEPTION 'Первый тур закрыт для изменений'; END IF;
 IF c.registration_status<>'registered' THEN RAISE EXCEPTION 'Кандидат не зарегистрирован'; END IF;
 IF p_game_pct IS NULL OR p_game_pct<0 OR p_game_pct>100
    OR p_game_pct::text IN ('NaN','Infinity','-Infinity')
 THEN RAISE EXCEPTION 'Игровой рейтинг должен составлять от 0 до 100 процентов'; END IF;
 IF p_poll_pct IS NOT NULL AND (p_poll_pct<0 OR p_poll_pct>100
    OR p_poll_pct::text IN ('NaN','Infinity','-Infinity'))
 THEN RAISE EXCEPTION 'Опрос должен составлять от 0 до 100 процентов'; END IF;
 SELECT status='closed' AND result IS TRUE INTO v_poll
 FROM public.presidential_poll_decision WHERE game_id=c.game_id;
 v_poll:=coalesce(v_poll,false);
 IF NOT v_poll AND p_poll_pct IS NOT NULL
 THEN RAISE EXCEPTION 'Социологический опрос не утверждён на шестом этапе'; END IF;
 INSERT INTO public.presidential_scorecards
   (game_id,candidate_id,round_no,game_rating_manual_pct,poll_pct,updated_by)
 VALUES(c.game_id,c.id,1,p_game_pct,CASE WHEN v_poll THEN p_poll_pct ELSE NULL END,auth.uid())
 ON CONFLICT(candidate_id,round_no) DO UPDATE
 SET game_rating_manual_pct=EXCLUDED.game_rating_manual_pct,
     poll_pct=EXCLUDED.poll_pct,
     computed_pct=NULL,unrounded_pct=NULL,updated_by=auth.uid(),updated_at=now();
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_presidential_rules_percentage(uuid,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_presidential_rules_percentage(uuid,numeric,numeric) TO authenticated;

-- Синхронизируем публичный результат (расчёт, итог, протокол), не переписывая другие правила.
DO $migrate$
DECLARE
 f text;
BEGIN
 f:=pg_get_functiondef('private.presidential_author_result(uuid,integer)'::regprocedure);
 IF position('game_rating_manual_pct as manual_pct' IN f)>0 THEN RETURN; END IF;
 IF position('coalesce(sc.game_rating_points,gm.score,0) as points,sc.poll_pct' IN f)=0
    OR position('game_pct:=case when total_points>0 then c.points*100/total_points else 0 end;' IN f)=0
    OR position('if p_round_no=1 and total_points<=0 then' IN f)=0
    OR position('program_pct numeric;' IN f)=0
    OR position('begin'||E'\n select * into s from presidential_election_settings' IN f)=0
    OR position('s.poll_enabled' IN f)=0
 THEN RAISE EXCEPTION 'Формула выборов изменилась: необходима проверка совместимости'; END IF;
 f:=replace(f,'coalesce(sc.game_rating_points,gm.score,0) as points,sc.poll_pct',
              'coalesce(sc.game_rating_points,gm.score,0) as points,sc.game_rating_manual_pct as manual_pct,sc.poll_pct');
 f:=replace(f,'game_pct:=case when total_points>0 then c.points*100/total_points else 0 end;',
              'game_pct:=coalesce(c.manual_pct,case when total_points>0 then c.points*100/total_points else 0 end);');
 -- Устаревшие игры по-прежнему могут показывать отношение к общей сумме до ручного ввода.
 -- Если все рейтинги введены вручную (включая 0), сумма старых очков больше не обязательна.
 f:=replace(f,'if p_round_no=1 and total_points<=0 then',
              'if p_round_no=1 and total_points<=0 and exists('||
              'select 1 from public.presidential_candidates pc left join public.presidential_scorecards sc '||
              'on sc.candidate_id=pc.id and sc.round_no=1 '||
              'where pc.game_id=p_game_id and pc.archived_at is null and pc.registration_status=''registered'' '||
              'and sc.game_rating_manual_pct is null) then');
 f:=replace(f,'program_pct numeric;','v_poll_enabled boolean:=false;program_pct numeric;');
 f:=replace(f,'begin'||E'\n select * into s from presidential_election_settings',
              'begin'||E'\n select coalesce(d.status=''closed'' AND d.result IS TRUE,false) into v_poll_enabled '||
              'from public.presidential_poll_decision d where d.game_id=p_game_id;'||
              E'\n v_poll_enabled:=coalesce(v_poll_enabled,false);'||
              E'\n select * into s from presidential_election_settings');
 f:=replace(f,'s.poll_enabled','v_poll_enabled');
 IF position('sc.game_rating_manual_pct as manual_pct' IN f)=0
    OR position('v_poll_enabled:=coalesce(v_poll_enabled,false)' IN f)=0
 THEN RAISE EXCEPTION 'Не удалось сформировать защищённую формулу рейтинга'; END IF;
 EXECUTE f;
END;
$migrate$;
