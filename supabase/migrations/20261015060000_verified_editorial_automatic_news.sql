-- ГОС.ID: verified, grammatically correct public news.
-- This migration changes only the representation of automatic publications.
-- It does not change stage completion, elections, ballots, chat access or scoring.
--
-- Trust boundary: only public registers and aggregate counts of explicitly
-- #сми_gpyasu-tagged PUBLIC channel messages; never private chat content.
CREATE OR REPLACE FUNCTION private.gos_verified_stage_news(p_game uuid, p_stage integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $fn$
DECLARE
 s public.game_stages%ROWTYPE;
 heading text;
 story text;
 facts integer := 0;
 committees text;
 committee_count integer;
 elected_chairs text;
 elected_count integer;
 leadership text;
 registered_parties text;
 registered_count integer;
 document_names text;
 document_count integer;
 closed_votes integer;
 public_discussions integer;
BEGIN
 SELECT * INTO s FROM public.game_stages
 WHERE game_id = p_game AND stage_no = p_stage;
 IF NOT FOUND OR s.status NOT IN ('open','completed') THEN
  RETURN NULL;
 END IF;

 IF s.status = 'open' THEN
  heading := format('Открыт этап %s: %s', s.stage_no, s.title);
  story := format(
   'Открыт новый этап политического процесса — «%s». ' ||
   'Принятые решения и подтверждённые результаты будут опубликованы после их оформления в соответствующих реестрах.',
   s.title
  );
  RETURN jsonb_build_object('title',heading,'body',story,'verified',true);
 END IF;

 heading := CASE
  WHEN p_stage = 4 THEN 'Государственная Дума завершила организационный этап: итоги и решения'
  WHEN p_stage = 1 THEN 'Политические партии: итоги первого этапа'
  WHEN p_stage = 7 THEN 'Президентская кампания: официальные итоги этапа'
  ELSE format('Завершён этап %s: %s',s.stage_no,s.title)
 END;
 story := CASE
  WHEN p_stage = 4 THEN
   'Первое заседание Государственной Думы Федерального Собрания Российской Федерации отмечено завершением соответствующего этапа политического процесса. ' ||
   'При этом завершение этапа и документально подтверждённые результаты отдельных выборов — разные события.'
  ELSE format('Этап %s «%s» получил статус «Завершён». Ниже — сведения, которые подтверждаются решениями и записями государственных органов.',s.stage_no,s.title)
 END;

 IF p_stage = 1 THEN
  SELECT count(*), string_agg(format('«%s»',name),'; ' ORDER BY name)
  INTO registered_count,registered_parties
  FROM public.game_parties WHERE game_id = p_game AND registration_status = 'registered';
  IF registered_count > 0 THEN
   story := story || E'\n\n' || 'Зарегистрированы политические партии: ' || registered_parties || '.';
   facts := facts + 1;
  END IF;
 END IF;

 IF p_stage = 4 THEN
  SELECT count(*), string_agg(title,'; ' ORDER BY unit_key)
  INTO committee_count,committees
  FROM public.institution_units
  WHERE game_id = p_game AND unit_kind = 'committee';
  IF committee_count > 0 THEN
   story := story || E'\n\n' ||
    CASE WHEN committee_count = 5 THEN
     'В составе Государственной Думы оформлены пять комитетов: '
    ELSE 'В реестре Государственной Думы указаны комитеты: ' END
    || committees || '.';
   facts := facts + 1;
  END IF;

  SELECT string_agg(
   format('%s — %s',
    CASE e.office_key
     WHEN 'gd_chair' THEN 'Председатель Государственной Думы'
     WHEN 'gd_deputy_1' THEN 'Первый заместитель Председателя Государственной Думы'
     ELSE 'Заместитель Председателя Государственной Думы' END,
    m.full_name),
   '; ' ORDER BY e.office_key)
  INTO leadership
  FROM public.office_elections e
  JOIN public.office_candidates c ON c.id = e.winner_candidate_id AND c.election_id = e.id AND c.game_id = p_game
  JOIN public.game_members m ON m.game_id = p_game AND m.user_id = c.user_id
  WHERE e.game_id = p_game AND e.stage_no = 4
   AND e.office_key IN ('gd_chair','gd_deputy_1','gd_deputy_2')
   AND e.status = 'finished' AND m.roster_archived_at IS NULL;
  IF leadership IS NOT NULL THEN
   story := story || E'\n\n' || 'По результатам завершённых выборов руководство палаты сформировано следующим образом: ' || leadership || '.';
   facts := facts + 1;
  END IF;

  SELECT count(*),string_agg(format('%s — %s',u.title,m.full_name),'; ' ORDER BY u.unit_key)
  INTO elected_count,elected_chairs
  FROM public.institution_units u
  JOIN public.game_members m ON m.game_id = p_game AND m.user_id = u.head_user_id
  WHERE u.game_id = p_game AND u.unit_kind = 'committee'
   AND m.roster_archived_at IS NULL
   AND EXISTS (
    SELECT 1 FROM public.office_elections e
    JOIN public.office_candidates c ON c.id = e.winner_candidate_id AND c.election_id = e.id
    WHERE e.game_id = p_game AND e.office_key = 'committee:'||u.id::text
     AND e.status = 'finished' AND c.user_id = u.head_user_id AND c.game_id = p_game
   );
  IF elected_count > 0 THEN
   story := story || E'\n\n' || 'Председатели комитетов, избрание которых подтверждено результатами голосований: ' || elected_chairs || '.';
   facts := facts + 1;
  END IF;
  IF committee_count = 0 THEN
   story := story || E'\n\n' ||
    'Сведения о сформированных комитетах пока отсутствуют в официальном реестре. Названия комитетов и имена их председателей поэтому не объявляются установленными итогами.';
  ELSIF elected_count < committee_count THEN
   story := story || E'\n\n' ||
    'Результаты выборов председателей остальных комитетов пока не подтверждены соответствующими протоколами.';
  END IF;
  IF leadership IS NULL THEN
   story := story || E'\n\n' ||
    'Подтверждённых результатов выборов руководства палаты в реестре на момент публикации нет.';
  END IF;
 END IF;

 SELECT count(*),string_agg(title,'; ' ORDER BY title)
 INTO document_count,document_names
 FROM (SELECT title FROM public.formal_documents
  WHERE game_id = p_game AND stage_no = p_stage
   AND status_code IN ('adopted','signed','published')
  ORDER BY title LIMIT 5) d;
 IF document_count > 0 THEN
  story := story || E'\n\n' ||
   'Среди оформленных актов этапа: ' || document_names ||
   CASE WHEN (SELECT count(*) FROM public.formal_documents WHERE game_id=p_game AND stage_no=p_stage AND status_code IN ('adopted','signed','published')) > 5
    THEN '; перечень остальных документов доступен в реестре.' ELSE '.' END;
  facts := facts + 1;
 END IF;

 SELECT count(*) INTO closed_votes
 FROM public.game_votes WHERE game_id = p_game AND stage_no = p_stage AND status='closed';
 IF closed_votes > 0 THEN
  story := story || E'\n\n' ||
   format('В реестре голосований этапа зафиксировано завершённых процедур: %s. Результаты каждого голосования доступны в его протоколе.',closed_votes);
  facts := facts + 1;
 END IF;

 -- Only an aggregate, not quotations. No access to private/group chats.
 SELECT count(*) INTO public_discussions
 FROM public.chat_messages m
 JOIN public.chat_channels c ON c.id=m.channel_id AND c.game_id=m.game_id
 WHERE m.game_id=p_game AND c.kind='public' AND c.name<>'Вне игры'
  AND m.kind='text' AND m.text ~* '#сми_gpyasu'
  AND m.created_at >= coalesce(s.opened_at,s.created_at)
  AND m.created_at <= coalesce(s.completed_at,now());
 IF public_discussions > 0 THEN
  story := story || E'\n\n' ||
   format('В открытых обсуждениях за время этапа для прессы отмечено сообщений: %s. Это отражает публичную дискуссию, но не заменяет официальных решений.',public_discussions);
 END IF;

 IF facts = 0 AND p_stage <> 4 THEN
  story := story || E'\n\n' ||
   'Подтверждённые итоги процедур пока не отражены в связанных реестрах. Планы и задания этапа не выдаются за принятые решения.';
 END IF;
 RETURN jsonb_build_object('title',heading,'body',story,'verified',true,
  'source_stage_no',s.stage_no,'facts_present',facts>0);
END;
$fn$;

REVOKE ALL ON FUNCTION private.gos_verified_stage_news(uuid,integer)
FROM public,anon,authenticated;

-- Latest record is re-read by ID from the same game, not from user-supplied prose.
CREATE OR REPLACE FUNCTION private.gos_editorial_automatic_post()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $fn$
DECLARE
 news jsonb;
 vote public.game_votes%ROWTYPE;
 candidate public.presidential_candidates%ROWTYPE;
 party_name text;
 result_intro text;
BEGIN
 IF new.source_key IS NULL OR new.context->>'automatic' IS DISTINCT FROM 'true' THEN
  RETURN new;
 END IF;
 IF new.context->>'source_table' = 'game_stages' THEN
  news := private.gos_verified_stage_news(new.game_id,(new.context->>'stage_no')::integer);
 ELSIF new.context->>'source_table' = 'game_votes' THEN
  SELECT * INTO vote FROM public.game_votes
  WHERE game_id=new.game_id AND id=new.internal_ref_id::uuid AND status='closed';
  IF FOUND THEN
   result_intro := CASE vote.result_code
    WHEN 'passed' THEN 'Решение принято.'
    WHEN 'rejected' THEN 'Решение не принято.'
    WHEN 'no_quorum' THEN 'Кворум не достигнут.'
    ELSE 'Голосование завершено.' END;
   news := jsonb_build_object(
    'title','Подведены итоги голосования: '||vote.title,
    'body','Завершена процедура голосования по вопросу «'||vote.title||'». '||result_intro||
      CASE WHEN vote.result_yes IS NOT NULL AND vote.result_no IS NOT NULL AND vote.result_abstain IS NOT NULL
       THEN format(E'\n\n' || 'Согласно протоколу: «за» — %s, «против» — %s, воздержались — %s.',vote.result_yes,vote.result_no,vote.result_abstain)
       ELSE E'\n\n' || 'Полные численные итоги голосования в доступной записи пока отсутствуют.' END,
    'verified',true);
  END IF;
 ELSIF new.context->>'source_table' = 'presidential_candidates' THEN
  SELECT * INTO candidate FROM public.presidential_candidates
  WHERE game_id=new.game_id AND id=new.internal_ref_id::uuid;
  IF FOUND AND new.source_key LIKE 'candidate:'||candidate.id::text||':'||candidate.registration_status||':%' THEN
   SELECT name INTO party_name FROM public.game_parties
   WHERE id=candidate.party_id AND game_id=new.game_id;
   news := jsonb_build_object(
    'title',CASE candidate.registration_status
     WHEN 'registered' THEN 'ЦИК зарегистрировала кандидатуру: '
     WHEN 'rejected' THEN 'ЦИК отказала в регистрации кандидатуры: '
     WHEN 'revision' THEN 'ЦИК направила документы на доработку: '
     WHEN 'withdrawn' THEN 'Кандидатура снята с выборов: '
     ELSE 'Поданы документы о выдвижении: ' END || candidate.display_name,
    'body','В рамках президентской кампании изменён официальный статус кандидатуры: ' ||
     candidate.display_name || '. ' ||
     'Субъект выдвижения — '||coalesce('политическая партия «'||party_name||'»','самовыдвижение')||'. '||
     CASE WHEN nullif(btrim(candidate.program_summary),'') IS NOT NULL
      THEN E'\n\n' || 'Опубликованы программные положения: '||candidate.program_summary
      ELSE 'Программа в доступных материалах пока не опубликована.' END,
    'verified',true);
  END IF;
 END IF;

 IF news IS NOT NULL THEN
  new.title := news->>'title';
  new.body := news->>'body';
  new.actor_key := 'media';
  new.actor_label := 'Республиканский обозреватель';
  new.context := new.context || jsonb_build_object('editorial_verified',true);
 END IF;
 RETURN new;
END;
$fn$;

REVOKE ALL ON FUNCTION private.gos_editorial_automatic_post()
FROM public,anon,authenticated;
DROP TRIGGER IF EXISTS gos_editorial_automatic_post ON public.political_posts;
CREATE TRIGGER gos_editorial_automatic_post
BEFORE INSERT ON public.political_posts
FOR EACH ROW EXECUTE FUNCTION private.gos_editorial_automatic_post();

-- Correct only original autogenerated stage reports. Never overwrite user content.
WITH revisions AS (
 SELECT s.game_id,s.id AS stage_id,n.news
 FROM public.game_stages s
 CROSS JOIN LATERAL private.gos_verified_stage_news(s.game_id,s.stage_no) AS n(news)
 WHERE s.status='completed' AND n.news IS NOT NULL
)
UPDATE public.political_posts p
SET title = r.news->>'title',
    body = r.news->>'body',
    actor_key = 'media',
    actor_label = 'Республиканский обозреватель',
    context = p.context || jsonb_build_object('editorial_verified',true)
FROM revisions r
WHERE p.game_id=r.game_id
 AND p.source_key LIKE 'stage:'||r.stage_id::text||':completed:%'
 AND p.context->>'source_table'='game_stages'
 AND p.context->>'automatic'='true'
 AND p.deleted_at IS NULL
 AND p.context->>'editorial_verified' IS DISTINCT FROM 'true';
