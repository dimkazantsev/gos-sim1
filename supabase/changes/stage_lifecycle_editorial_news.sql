-- Stage lifecycle belongs to ГОС.ID; registered results belong to the newsroom.
-- No changes to gameplay, ballots, scoring or client database requests.
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
 vote_details text;
 regional_rule_id uuid;
 details text;
 extra text;
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

 heading := CASE p_stage
  WHEN 1 THEN 'Регистрация политических партий: итоги этапа'
  WHEN 2 THEN 'Парламентские выборы: правила и распределение мандатов'
  WHEN 3 THEN 'Региональные выборы: решения и представительство'
  WHEN 4 THEN 'Государственная Дума: руководство, комитеты и решения'
  WHEN 5 THEN 'Ghost voting: принятое правило и результаты распределения'
  WHEN 6 THEN 'Президентская кампания: итоги регистрации'
  WHEN 7 THEN 'Президентские выборы: официальный результат'
  WHEN 8 THEN 'Формирование Правительства: Председатель и структура'
  WHEN 9 THEN 'Министерства: назначения и состав руководства'
  WHEN 10 THEN 'Государственные программы: итоги подготовки'
  WHEN 11 THEN 'Государственные программы: решения Правительства'
  WHEN 12 THEN 'Законодательная работа: проекты и принятые акты'
  WHEN 13 THEN 'Федеральный бюджет: доходы, расходы и принятые решения'
  WHEN 14 THEN 'Муниципальные решения: утверждённые проекты'
  WHEN 15 THEN 'Антикризисное управление: состояние и результаты'
  WHEN 16 THEN 'Итоги политического процесса: решения и участие'
  ELSE format('Итоги этапа %s: %s',s.stage_no,s.title) END;
 story := CASE p_stage
  WHEN 1 THEN 'Первый этап посвятили формированию политических партий и оформлению их регистрации. Официальный реестр позволяет установить, какие объединения получили право участвовать в дальнейших политических процедурах.'
  WHEN 2 THEN 'Рассмотрение избирательной модели определяет, как поддержка партий превращается в депутатские мандаты. В новости представлены утверждённые правила и опубликованные расчёты.'
  WHEN 3 THEN 'Региональный этап посвящён представительству политических сил в субъектах Российской Федерации. Его содержательные итоги отражают утверждённый способ распределения и оформленные результаты.'
  WHEN 4 THEN 'Организационное заседание Государственной Думы Федерального Собрания Российской Федерации посвящено избранию руководства палаты и формированию комитетов. Ниже приведены результаты завершённых выборов и официальные записи о составе палаты.'
  WHEN 5 THEN 'Процедура Ghost voting связана с доступным числом голосов фракций при парламентском голосовании. В сводке отдельно отражены принятое правило и фактически выполненное распределение.'
  WHEN 6 THEN 'Президентская кампания перешла к рассмотрению кандидатур. Регистрация избирательной комиссией подтверждает допуск к выборам; подача документов сама по себе такого результата не означает.'
  WHEN 7 THEN 'Результат президентских выборов определяется завершённой избирательной процедурой. Сведения о победителе приводятся по официальному расчёту, а не по промежуточному опросу общественного мнения.'
  WHEN 8 THEN 'Формирование Правительства Российской Федерации объединяет кадровое решение о его руководителе и утверждение структуры ведомств. В сводке приведены действующие назначения и принятая структура.'
  WHEN 9 THEN 'Формирование руководства ведомств определяет, кто отвечает за дальнейшую подготовку государственных решений. Имена и должности приведены по реестру действующих назначений.'
  WHEN 10 THEN 'Подготовка государственных программ связывает цели государственной политики с конкретными проектами решений. Передача программы на согласование отражается отдельно от её окончательного принятия.'
  WHEN 11 THEN 'Представление государственных программ позволяет перейти от подготовки предложений к оформлению решений Правительства Российской Федерации. В новости перечислены принятые программы и сведения об их подписании.'
  WHEN 12 THEN 'Этап законодательной работы посвящён проектам нормативных правовых актов. Правовой статус каждого документа сохраняется: направленный на рассмотрение проект не объявляется вступившим в силу законом.'
  WHEN 13 THEN 'Бюджетные решения определяют доходы государства, направления расходов и их баланс. Финансовые показатели приведены по окончательным расчётам, связанным с оформленными бюджетными документами.'
  WHEN 14 THEN 'Муниципальный этап посвящён решению вопросов местного значения. Итоги отражают проекты, получившие официальное одобрение, и оформленные акты местного самоуправления.'
  WHEN 15 THEN 'Антикризисная работа требует отделять предложенные меры от достигнутого результата. В сводке сопоставлены зарегистрированные кризисы и случаи, урегулирование которых подтверждено в реестре.'
  WHEN 16 THEN 'Подготовлена итоговая сводка политического процесса. Она объединяет фактическое участие, завершённые этапы и оформленные решения; незавершённые процедуры в результаты не включаются.'
  ELSE format('Итоги этапа %s: %s',s.stage_no,s.title) END;


 IF p_stage = 1 THEN
  SELECT count(*), string_agg(format('«%s»%s',p.name,CASE WHEN m.full_name IS NOT NULL THEN ' (Председатель — '||m.full_name||')' ELSE '' END),'; ' ORDER BY p.name)
  INTO registered_count,registered_parties
  FROM public.game_parties p LEFT JOIN public.game_members m
   ON m.game_id=p.game_id AND m.user_id=p.leader_user_id AND m.roster_archived_at IS NULL
  WHERE p.game_id = p_game AND p.registration_status = 'registered';
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
     WHEN 'gd_deputy_1' THEN 'Заместитель Председателя Государственной Думы'
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

 -- Stage-specific facts are read once on publication and stored in the post.
 CASE p_stage
 WHEN 2 THEN
  SELECT string_agg('Утверждена '||CASE system_type WHEN 'proportional' THEN 'пропорциональная'
   WHEN 'majoritarian' THEN 'мажоритарная' ELSE 'смешанная' END||' избирательная система.'||
   CASE WHEN allocation_method IS NOT NULL THEN ' Метод распределения мандатов — '||
    CASE allocation_method WHEN 'hare' THEN 'квота Хэйра' WHEN 'droop' THEN 'квота Друпа'
     WHEN 'dhondt' THEN 'метод Д’Ондта' WHEN 'sainte_lague' THEN 'метод Сент-Лагю'
     WHEN 'imperiali' THEN 'метод Империали' END||'.' ELSE '' END||
   CASE WHEN system_type='mixed' AND proportional_share IS NOT NULL
    THEN format(' Доля пропорциональной части — %s%%.',proportional_share) ELSE '' END,E'\n\n' ORDER BY created_at)
  INTO details FROM public.parliamentary_election_rules WHERE game_id=p_game AND status='adopted';
  IF EXISTS(SELECT 1 FROM public.electoral_calculator_results WHERE game_id=p_game AND published) THEN
   SELECT string_agg(format('«%s» — %s',name,mandates),'; ' ORDER BY name)
   INTO extra FROM public.game_parties WHERE game_id=p_game AND registration_status='registered' AND mandates IS NOT NULL;
   IF extra IS NOT NULL THEN details:=concat_ws(E'\n\n',details,'Опубликованное распределение мандатов: '||extra||'.');END IF;
  END IF;
 WHEN 3 THEN
  SELECT string_agg('Утверждён способ распределения регионального представительства — '||
   CASE method WHEN 'random' THEN 'жеребьёвка' WHEN 'proportional' THEN 'пропорциональное распределение'
    WHEN 'agreement' THEN 'соглашение партий' END||'.',E'\n\n' ORDER BY created_at)
  INTO details FROM public.regional_election_rules WHERE game_id=p_game AND status='adopted';
  SELECT id INTO regional_rule_id FROM public.regional_election_rules
  WHERE game_id=p_game AND status='allocated' ORDER BY updated_at DESC LIMIT 1;
  IF regional_rule_id IS NOT NULL THEN
   extra:=private.gos_regional_allocation_report(regional_rule_id);
   IF extra IS NOT NULL THEN details:=concat_ws(E'\n\n',details,extra);END IF;
  END IF;
 WHEN 5 THEN
  SELECT string_agg('Принято правило Ghost voting: '||CASE policy_mode WHEN 'prohibited' THEN 'запрет'
   WHEN 'justified' THEN 'применение с обоснованием' WHEN 'allowed' THEN 'применение разрешено' END||'.',E'\n\n' ORDER BY created_at)
  INTO details FROM public.ghost_voting_policies WHERE game_id=p_game AND status='adopted';
  SELECT CASE status WHEN 'drawn' THEN format('В последнем распределении Ghost voting зафиксирована потеря голосов: %s.',total_loss)
   ELSE 'Результат последнего распределения Ghost voting снят.' END
  INTO extra FROM public.ghost_voting_rounds WHERE game_id=p_game AND stage_no=5 ORDER BY created_at DESC,id LIMIT 1;
  details:=nullif(concat_ws(E'\n\n',details,extra),'');
 WHEN 6 THEN
  SELECT string_agg(format('%s — %s',c.display_name,coalesce('партия «'||p.name||'»','самовыдвижение')),'; ' ORDER BY c.display_name)
  INTO extra FROM public.presidential_candidates c LEFT JOIN public.game_parties p ON p.id=c.party_id AND p.game_id=c.game_id
  WHERE c.game_id=p_game AND c.registration_status='registered' AND c.cec_submitted_at IS NOT NULL AND c.archived_at IS NULL;
  IF extra IS NOT NULL THEN details:='Избирательная комиссия зарегистрировала кандидатуры: '||extra||'.';END IF;
 WHEN 7 THEN
  SELECT 'Избранный Президент Российской Федерации — '||c.display_name||'. Субъект выдвижения — '||
   coalesce('политическая партия «'||p.name||'»','самовыдвижение')||'.'||
   CASE WHEN e.result->>'score' IS NOT NULL THEN ' Итоговый показатель по официальному расчёту — '||(e.result->>'score')||'%.' ELSE '' END
  INTO details FROM public.presidential_election_settings e
  JOIN public.presidential_candidates c ON c.game_id=e.game_id AND c.id::text=e.result->>'winner_id'
  LEFT JOIN public.game_parties p ON p.id=c.party_id AND p.game_id=c.game_id
  WHERE e.game_id=p_game AND e.status='finished';
 WHEN 8 THEN
  SELECT string_agg(format('%s — %s',o.role_title,m.full_name),'; ' ORDER BY o.role_title,m.full_name)
  INTO extra FROM public.game_office_assignments o
  JOIN public.game_members m ON m.game_id=o.game_id AND m.user_id=o.user_id AND m.roster_archived_at IS NULL
  WHERE o.game_id=p_game AND o.status='active' AND private.stage_comic_office_key(o.role_title)='prime_minister';
  IF extra IS NOT NULL THEN details:='Действующее назначение: '||extra||'.';END IF;
  SELECT string_agg(t.title,'; ' ORDER BY t.no) INTO extra FROM public.government_structures g
   CROSS JOIN LATERAL (VALUES(1,g.social_title),(2,g.economic_title),(3,g.defence_title),(4,g.foreign_title),(5,g.internal_title)) t(no,title)
  WHERE g.game_id=p_game AND g.status='approved' AND nullif(btrim(t.title),'') IS NOT NULL;
  IF extra IS NOT NULL THEN details:=concat_ws(E'\n\n',details,'Утверждённая структура Правительства включает ведомства: '||extra||'.');END IF;
 WHEN 9 THEN
  SELECT string_agg(format('%s — %s',o.role_title,m.full_name),'; ' ORDER BY o.role_title,m.full_name)
  INTO extra FROM public.game_office_assignments o
  JOIN public.game_members m ON m.game_id=o.game_id AND m.user_id=o.user_id AND m.roster_archived_at IS NULL
  WHERE o.game_id=p_game AND o.status='active' AND o.role_title ~* '^министр(\s|$)';
  IF extra IS NOT NULL THEN details:='В реестре действующих назначений руководителями ведомств указаны: '||extra||'.';END IF;
 WHEN 10 THEN
  SELECT string_agg(format('«%s»%s',title,CASE WHEN nullif(btrim(responsible_ministry),'') IS NOT NULL THEN ' — '||responsible_ministry ELSE '' END),'; ' ORDER BY title)
  INTO extra FROM public.state_programs WHERE game_id=p_game AND status IN ('minister_review','pm_review','ready','government_vote','adopted');
  IF extra IS NOT NULL THEN details:='Из подготовки в процедуру рассмотрения переданы государственные программы: '||extra||'. Их принятие отражается отдельным решением Правительства.';END IF;
 WHEN 11 THEN
  SELECT string_agg(format('«%s»%s',title,CASE WHEN signed_at IS NOT NULL THEN ' (Подписана Председателем Правительства)' ELSE ' (Принята; подпись ещё не оформлена)' END),'; ' ORDER BY title)
  INTO extra FROM public.state_programs WHERE game_id=p_game AND status='adopted';
  IF extra IS NOT NULL THEN details:='Правительство приняло государственные программы: '||extra||'.';END IF;
 WHEN 12 THEN
  SELECT string_agg(format('«%s» — %s',title,status_label),'; ' ORDER BY title)
  INTO extra FROM (SELECT title,status_label FROM public.formal_documents
   WHERE game_id=p_game AND stage_no=12 AND status_code NOT IN ('draft','rejected')
    AND coalesce(doc_type,'') NOT IN ('justice_response','party_certificate') ORDER BY title LIMIT 8) d;
  IF extra IS NOT NULL THEN details:='В реестре законодательной работы отражены документы: '||extra||'.';END IF;
 WHEN 13 THEN
  SELECT string_agg(format('Бюджет «%s» на %s год: доходы — %s трлн ₽, расходы — %s трлн ₽, баланс — %s трлн ₽.',
   b.title,b.budget_year,replace(b.revenue::text,'.',','),replace(b.expenditure::text,'.',','),replace(b.balance::text,'.',',')),E'\n\n' ORDER BY b.budget_year,b.created_at)
  INTO details FROM public.budget_scenarios b WHERE b.game_id=p_game AND b.status='final'
   AND b.revenue IS NOT NULL AND b.expenditure IS NOT NULL AND b.balance IS NOT NULL AND b.budget_year IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.formal_documents d WHERE d.game_id=b.game_id AND d.id=b.formal_document_id
    AND d.status_code IN ('adopted','signed','published'));
 WHEN 14 THEN
  SELECT string_agg(format('«%s»%s',problem_title,CASE WHEN nullif(btrim(location_text),'') IS NOT NULL THEN ' ('||location_text||')' ELSE '' END),'; ' ORDER BY created_at)
  INTO extra FROM public.municipal_projects WHERE game_id=p_game AND stage_no=14 AND status='adopted';
  IF extra IS NOT NULL THEN details:='Официальное одобрение получили муниципальные проекты: '||extra||'.';END IF;
 WHEN 15 THEN
  SELECT CASE WHEN count(*)>0 THEN format('В реестре этапа зарегистрировано кризисов: %s. Подтверждённое урегулирование: %s.',
   count(*),count(*) FILTER(WHERE status='resolved')) END
  INTO details FROM public.game_crises WHERE game_id=p_game AND stage_no=15;
  SELECT string_agg(left(description,200),'; ' ORDER BY resolved_at,id)
  INTO extra FROM public.game_crises WHERE game_id=p_game AND stage_no=15 AND status='resolved';
  IF extra IS NOT NULL THEN details:=details||E'\n\nУрегулированы ситуации: '||extra||'.';END IF;
 WHEN 16 THEN
  details:=format('На момент итогового обсуждения завершено этапов: %s из 16. В действующем составе участников: %s. Зарегистрировано партий: %s.',
   (SELECT count(*) FROM public.game_stages WHERE game_id=p_game AND status='completed'),
   (SELECT count(*) FROM public.game_members WHERE game_id=p_game AND roster_archived_at IS NULL),
   (SELECT count(*) FROM public.game_parties WHERE game_id=p_game AND registration_status='registered'))||
   E'\n\n'||format('Оформлено принятых, подписанных и опубликованных актов: %s. Завершено голосований: %s. Принято государственных программ: %s. Сохранено итоговых обсуждений: %s.',
   (SELECT count(*) FROM public.formal_documents WHERE game_id=p_game AND status_code IN ('adopted','signed','published')
    AND coalesce(doc_type,'') NOT IN ('justice_response','party_certificate')),
   (SELECT count(*) FROM public.game_votes WHERE game_id=p_game AND status='closed'),
   (SELECT count(*) FROM public.state_programs WHERE game_id=p_game AND status='adopted'),
   (SELECT count(*) FROM public.stage_debriefs WHERE game_id=p_game));
 ELSE NULL;
 END CASE;
 IF nullif(details,'') IS NOT NULL THEN story:=story||E'\n\n'||details;facts:=facts+1;END IF;


 SELECT count(*),string_agg(format('«%s» — [Открыть документ](gos:documents?id=%s)',title,id::text),'; ' ORDER BY title)
 INTO document_count,document_names
 FROM (SELECT id,title FROM public.formal_documents
  WHERE game_id = p_game AND stage_no = p_stage
   AND coalesce(doc_type,'') NOT IN ('justice_response','party_certificate')
   AND status_code IN ('adopted','signed','published')
  ORDER BY title LIMIT 5) d;
 IF document_count > 0 THEN
  story := story || E'\n\n' ||
   'Среди оформленных актов этапа: ' || document_names ||
   CASE WHEN (SELECT count(*) FROM public.formal_documents WHERE game_id=p_game AND stage_no=p_stage AND status_code IN ('adopted','signed','published')
     AND coalesce(doc_type,'') NOT IN ('justice_response','party_certificate')) > 5
    THEN '; перечень остальных документов доступен в реестре.' ELSE '.' END;
  facts := facts + 1;
 END IF;

 SELECT count(*),string_agg(
   format('«%s»: %s%s. [Открыть протокол](gos:votes?id=%s)',
     v.title,
     CASE v.result_code
      WHEN 'passed' THEN 'решение принято'
      WHEN 'rejected' THEN 'решение отклонено'
      WHEN 'no_quorum' THEN 'кворум не достигнут'
      ELSE 'процедура завершена, итог уточняется по протоколу' END,
     CASE WHEN v.result_yes IS NOT NULL AND v.result_no IS NOT NULL AND v.result_abstain IS NOT NULL
       THEN format(' («за» — %s, «против» — %s, воздержались — %s)',v.result_yes,v.result_no,v.result_abstain)
       ELSE '' END,v.id::text),
    E'\n' ORDER BY v.closed_at,v.title)
 INTO closed_votes,vote_details
 FROM public.game_votes v WHERE v.game_id=p_game AND v.stage_no=p_stage AND v.status='closed';
 IF closed_votes > 0 THEN
  story:=story||E'\n\n'||format('По %s голосованиям зафиксированы следующие решения:',closed_votes)||E'\n'||vote_details;
  facts:=facts+1;
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
 IF position('gos:stages?stage=' in story)=0 THEN
  story:=story||E'\n\n'||format('[Перейти к материалам этапа %s](gos:stages?stage=%s)',s.stage_no,s.stage_no);
 END IF;
 RETURN jsonb_build_object('title',heading,'body',story,'verified',true,
  'source_stage_no',s.stage_no,'facts_present',facts>0);
END;
$fn$;

REVOKE ALL ON FUNCTION private.gos_verified_stage_news(uuid,integer)
FROM public,anon,authenticated;

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
 IF new.context->>'source_table' = 'game_stages' AND new.context->>'stage_notice' IN ('opened','closed') THEN
  new.actor_key := 'system';
  new.actor_label := 'ГОС.ID';
  new.process_type := 'information';
  new.context := new.context || jsonb_build_object('editorial_verified',false);
  RETURN new;
 END IF;
 IF new.context->>'source_table' = 'game_stages' THEN
  new.process_type := 'news';
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



-- Dedicated publisher: stage controls never go through a media account.
CREATE OR REPLACE FUNCTION private.publish_stage_process_news()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE uid uuid;stamp text;ctx jsonb;heading text;
BEGIN
 IF new.status=old.status OR new.status NOT IN ('open','completed') THEN RETURN new;END IF;
 SELECT coalesce(auth.uid(),owner_id) INTO uid FROM public.games WHERE id=new.game_id;
 IF uid IS NULL THEN RETURN new;END IF;
 stamp:=coalesce(CASE WHEN new.status='open' THEN new.opened_at ELSE new.completed_at END,clock_timestamp())::text;
 ctx:=jsonb_build_object('automatic',true,'source_table','game_stages','stage_no',new.stage_no,'stage_title',new.title);
 heading:=CASE WHEN new.status='open' THEN 'Открыт этап ' ELSE 'Закрыт этап ' END||new.stage_no||': '||new.title;
 INSERT INTO public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,internal_view,internal_ref_id,source_key,context)
 VALUES(new.game_id,uid,'information','system','ГОС.ID',heading,
  CASE WHEN new.status='open'
   THEN format('Этап %s «%s» открыт. Доступные действия и сроки указаны в разделе «Этапы».',new.stage_no,new.title)
   ELSE format('Этап %s «%s» закрыт. Итоги процедур публикуются отдельной новостью по подтверждённым данным реестров.',new.stage_no,new.title) END,
  ARRAY['этап_gpyasu','ходигры_gpyasu'],'stages',new.id::text,
  'stage:'||new.id::text||':'||new.status||':'||stamp,
  ctx||jsonb_build_object('stage_notice',CASE WHEN new.status='open' THEN 'opened' ELSE 'closed' END))
 ON CONFLICT(game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING;
 IF new.status='completed' THEN
  INSERT INTO public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,internal_view,internal_ref_id,source_key,context)
  VALUES(new.game_id,uid,'news','media','Республиканский обозреватель','Итоги этапа '||new.stage_no,
   'Подтверждённые результаты этапа.',ARRAY['этап_gpyasu','итоги_gpyasu','сми_gpyasu'],'stages',new.id::text,
   'stage-result:'||new.id::text||':'||stamp,ctx||jsonb_build_object('news_kind','stage_result'))
  ON CONFLICT(game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING;
 END IF;
 RETURN new;
END;$fn$;
REVOKE ALL ON FUNCTION private.publish_stage_process_news() FROM public,anon,authenticated;
DROP TRIGGER IF EXISTS publish_stage_process ON public.game_stages;
CREATE TRIGGER publish_stage_process AFTER UPDATE OF status ON public.game_stages
FOR EACH ROW EXECUTE FUNCTION private.publish_stage_process_news();


CREATE OR REPLACE FUNCTION private.capture_completed_stage_comic()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare endpoint integer;first_stage integer;snap jsonb;news_snap jsonb;chapter_title text;
begin
 if new.status<>'completed' or old.status='completed' then return new;end if;
 endpoint:=case new.stage_no when 2 then 3 when 4 then 5 else new.stage_no end;
 if endpoint in (1,3,5,7,8,11,12,13,14,15,16) then
  -- Serialize closures in one game so concurrently completing grouped stages cannot both miss their peer.
  perform 1 from games where id=new.game_id for update;
  first_stage:=case endpoint when 3 then 2 when 5 then 4 else endpoint end;
  if (select count(*) from game_stages where game_id=new.game_id and stage_no between first_stage and endpoint and status='completed')=endpoint-first_stage+1 then
   snap:=private.stage_result_comic_snapshot(new.game_id,endpoint);
   chapter_title:=case when endpoint=16 then 'Эпилог · Итоги игры' when endpoint in (3,5) then 'Итоги этапов '||first_stage||' и '||endpoint else 'Итоги этапа '||endpoint end;
   insert into republic_comic_chapters(game_id,stage_no,kind,title,body,snapshot)
    values(new.game_id,endpoint,'completed',chapter_title,'Сохранённые результаты игры.',snap) on conflict(game_id,stage_no,kind) do nothing;
  end if;
 end if;
 -- Preserve the existing stage-news integration, including stages without a comic.
 news_snap:=jsonb_build_object('documents',(select count(*) from formal_documents where game_id=new.game_id and stage_no=new.stage_no),
  'finished_documents',(select count(*) from formal_documents where game_id=new.game_id and stage_no=new.stage_no and status_code in ('published','adopted','signed')),
  'votes',(select count(*) from game_votes where game_id=new.game_id and stage_no=new.stage_no),
  'passed_votes',(select count(*) from game_votes where game_id=new.game_id and stage_no=new.stage_no and result_code='passed'),
  'metrics',(select jsonb_object_agg(metric_key,value) from state_metrics where game_id=new.game_id and is_public),
  'document_ids',(select coalesce(jsonb_agg(id),'[]'::jsonb) from formal_documents where game_id=new.game_id and stage_no=new.stage_no),
  'vote_ids',(select coalesce(jsonb_agg(id),'[]'::jsonb) from game_votes where game_id=new.game_id and stage_no=new.stage_no));
 update political_posts set context=context||jsonb_build_object('stage_snapshot',news_snap)
  where game_id=new.game_id and source_key='stage-result:'||new.id::text||':'||new.completed_at::text;
 return new;
end$function$;

REVOKE ALL ON FUNCTION private.capture_completed_stage_comic() FROM public,anon,authenticated;


-- Repair only active automatic lifecycle entries, preserving bodies and chronology.
UPDATE public.political_posts
SET actor_key='system',actor_label='ГОС.ID',process_type='information',
 tags=array_remove(tags,'сми_gpyasu'),
 context=context||jsonb_build_object('stage_notice','opened','editorial_verified',false)
WHERE deleted_at IS NULL AND context->>'automatic'='true' AND context->>'source_table'='game_stages'
 AND source_key LIKE 'stage:%:open:%';
-- Historic completed stories remain stories; never reconstruct past facts from today's registers.
UPDATE public.political_posts
SET actor_key='media',actor_label='Республиканский обозреватель',process_type='news',
 context=context||jsonb_build_object('news_kind','stage_result')
WHERE deleted_at IS NULL AND context->>'automatic'='true' AND context->>'source_table'='game_stages'
 AND source_key LIKE 'stage:%:completed:%' AND context->>'stage_notice' IS DISTINCT FROM 'closed';
INSERT INTO public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,
 internal_view,internal_ref_id,source_key,context,created_at,updated_at)
SELECT p.game_id,p.author_id,'information','system','ГОС.ID',
 'Закрыт этап '||(p.context->>'stage_no')||': '||coalesce(p.context->>'stage_title','Завершение работы'),
 'Этап '||(p.context->>'stage_no')||' закрыт. Подтверждённые итоги приведены в отдельной новости СМИ.',
 ARRAY['этап_gpyasu','ходигры_gpyasu'],'stages',p.internal_ref_id,'stage-notice:'||p.id::text,
 (p.context-'stage_snapshot')||jsonb_build_object('stage_notice','closed','editorial_verified',false,'news_kind',null),
 p.created_at,p.updated_at
FROM public.political_posts p
WHERE p.deleted_at IS NULL AND p.context->>'automatic'='true' AND p.context->>'source_table'='game_stages'
 AND p.source_key LIKE 'stage:%:completed:%' AND p.context->>'stage_notice' IS DISTINCT FROM 'closed'
ON CONFLICT(game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING;



