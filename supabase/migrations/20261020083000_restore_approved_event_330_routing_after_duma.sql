-- ГОС.ID / ПАУ. Восстановление утверждённой матрицы для действующей игры.
-- Источник: 20261011180500_event_case_330_matrix.sql +
-- 20261011180600_event_case_330_competence.sql (330 строк, исходный порядок case_key).
-- Никаких новых кейсов, автоматической перемены компетенций или удаления решений.
CREATE OR REPLACE FUNCTION private.ensure_event_case_routing(p_game uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $routes$
DECLARE
 v_stage_codes constant text:='eaae9999eeeaa989eaeaf9aa9a9aa8a9aae9eaaf9fa99aa8e99ea999a7e9ae998ae99999e9eee99e999ee99e9e9e9eae998e89ee9eee99e9a98ea9aaffaaeaaefd8ae9daaa98de9aadddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddcccccccc1177ccccccccccccccccccdcccddcccccccccccceccc1ccccccccad8e9dddddddddddddddddddddddddddddd';
 v_org_codes constant text:='56857777575897g77g58d46g9g79bg83g95986gd4867a6b1gd3514ba8d5gb5dbg857gb1h5g555g7555g557g5g575g59577g5g7757555775797g59g68949d5bb54bg857b68g4gb5468eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeifiii0ffff22fffffffffffffffffffffffffffffiffiiiiffff0fiifffff8bg57eeeeeeeeeeeeeeeeeeeeeeeecccccc';
 v_total int;v_known int;v_existing int;v_added int:=0;v_regional int;
BEGIN
 SELECT count(*),count(*) FILTER (WHERE EXISTS(
   SELECT 1 FROM private.authored_event_catalog cat WHERE cat.case_key=ec.case_key
 )) INTO v_total,v_known
 FROM public.event_cases ec WHERE ec.game_id=p_game AND ec.status='ready';
 IF v_total<>330 OR v_known<>330 THEN RETURN 0; END IF;
 SELECT count(*) INTO v_existing FROM public.event_case_routing WHERE game_id=p_game;
 IF v_existing=330 THEN RETURN 0; END IF;
 IF length(v_stage_codes)<>330 OR length(v_org_codes)<>330
 THEN RAISE EXCEPTION 'Утверждённая матрица игровых ситуаций повреждена'; END IF;
 WITH numbered AS(
  SELECT ec.game_id,ec.id,ec.case_key,ec.audience,
   row_number() over(order by ec.case_key) rn
  FROM public.event_cases ec WHERE ec.game_id=p_game AND ec.status='ready'
 ),mapped AS(
  SELECT n.*,
   strpos('0123456789abcdef',substr(v_stage_codes,n.rn::int,1))-1 early,
   strpos('0123456789abcdefghijklmnopqrstuv',substr(v_org_codes,n.rn::int,1))-1 org_idx,
   CASE WHEN n.case_key LIKE 'bank-legal-2026-%'
          AND substring(n.case_key from '[0-9]+$')::int BETWEEN 1 AND 89
     THEN (SELECT code FROM public.fiscal_region_reference ORDER BY code
       OFFSET (substring(n.case_key from '[0-9]+$')::int-1) LIMIT 1)
    WHEN n.case_key ~ '^budget-region-2026-[0-9]{2}-'
     THEN substring(n.case_key from '^budget-region-2026-([0-9]{2})-')
    ELSE NULL END region
  FROM numbered n
 ),orgs AS(
  SELECT arr,(ordinality-1) idx FROM unnest(array[
  'Государственная Дума / депутат',
  'Депутат ГД / комиссия (уточнить)',
  'Избирательная комиссия',
  'МИД / Правительство РФ',
  'МЧС / региональные службы (совместно)',
  'Местное самоуправление / профильная администрация',
  'Минздрав / региональный орган здравоохранения',
  'Минкультуры / муниципальные учреждения',
  'Минобрнауки / Минпросвещения; региональный профильный орган',
  'Минприроды / профильный природоохранный орган',
  'Минтранс / региональные транспортные органы',
  'Минфин / Минэкономразвития / Минтруд (по сфере)',
  'Минфин РФ / Правительство РФ',
  'Минцифры / оператор системы',
  'Победившая региональная партия / губернатор; финансовый орган региона',
  'Правительство / Минюст (уточнить компетенцию)',
  'Профильное федеральное министерство (уточнить)',
  'Профильный компетентный орган (ручное сопоставление)',
  'Судебные органы; правовая служба (по полномочию)'
  ]) WITH ORDINALITY AS t(arr,ordinality)
 )
 INSERT INTO public.event_case_routing(game_id,case_id,earliest_stage,latest_stage,
   region_code,destination,requires_office,competent_org)
 SELECT m.game_id,m.id,greatest(6,m.early),15,m.region,
  CASE WHEN m.region IS NOT NULL AND m.audience='group' THEN 'regional_joint'
       WHEN m.region IS NOT NULL THEN 'regional'
       WHEN m.audience='all' THEN 'federal_collective'
       WHEN m.audience='group' THEN 'federal_joint'
       ELSE 'individual' END,
  true,o.arr
 FROM mapped m JOIN orgs o ON o.idx=m.org_idx
 WHERE m.early BETWEEN 1 AND 15
 ON CONFLICT(game_id,case_id) DO NOTHING;
 GET DIAGNOSTICS v_added=ROW_COUNT;
 SELECT count(*),count(*) FILTER(WHERE region_code IS NOT NULL)
  INTO v_existing,v_regional FROM public.event_case_routing WHERE game_id=p_game;
 IF v_existing<>330 OR v_regional<>113
 THEN RAISE EXCEPTION 'Маршрутизация неполна: всего %, региональных %',v_existing,v_regional; END IF;
 RETURN v_added;
END;
$routes$;
REVOKE ALL ON FUNCTION private.ensure_event_case_routing(uuid) FROM PUBLIC,anon,authenticated;

-- Автопилот выдаёт задания начиная с фактически принятых итогов выборов ГД,
-- а не с момента появления регистрации проекта выборов. Проверяются принятие
-- системы и наличие хотя бы одного действующего назначения депутата.
-- Существующий часовой Cron сохраняется; маршруты создаются ровно один раз.
DO $patch$
DECLARE v_def text;
v_anchor text:='select current_round into v_round from public.games where id=p_game;';
BEGIN
 v_def:=pg_get_functiondef('private.run_game_autopilot(uuid)'::regprocedure);
 IF position('private.ensure_event_case_routing(p_game)' IN v_def)>0 THEN RETURN; END IF;
 IF position(v_anchor IN v_def)=0
   OR position('routing_not_configured' IN v_def)=0
   OR position('for update skip locked' IN lower(v_def))=0
   OR position('ea.status=''pending''' IN v_def)=0
 THEN RAISE EXCEPTION 'Действующие правила автопилота изменены; требуется повторная проверка'; END IF;
 v_def:=replace(v_def,v_anchor,
 v_anchor||E'\n'
 ||' if v_round<6 or not exists(select 1 from public.parliamentary_election_rules e '
 ||' where e.game_id=p_game and e.status=''adopted'') '
 ||' or not exists(select 1 from public.game_office_assignments o '
 ||' where o.game_id=p_game and o.status=''active'' '
 ||' and lower(o.role_title) like ''%депутат государственной думы%'') then '
 ||' return jsonb_build_object(''sent'',0,''reason'',''duma_not_elected'');end if;'
 ||E'\n'
 ||' if not exists(select 1 from public.event_case_routing where game_id=p_game) then '
 ||' perform private.ensure_event_case_routing(p_game);end if;');
 IF position('duma_not_elected' IN v_def)=0
 THEN RAISE EXCEPTION 'Не удалось установить условие выборов Государственной Думы'; END IF;
 EXECUTE v_def;
END;
$patch$;

-- Восстановить существующим активным сценариям маршруты без принудительной
-- рассылки (следующий Cron или действие преподавателя распределит по правилам).
SELECT private.ensure_event_case_routing(s.game_id)
 FROM public.event_auto_settings s WHERE s.enabled;
