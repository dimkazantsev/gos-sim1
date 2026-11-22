-- ГОС.ID. Atomic legally named Bank of Russia rate decision, immediate adoption,
-- immutable formal registry entry and chair-only personal signature publication.
-- One client RPC replaces separate rate/save/document operations.
-- Bank decisions: active chairman with verified appointment, no role spoofing.
CREATE OR REPLACE FUNCTION private.can_issue_bank_rate_decision(p_game uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $f$
SELECT p_user IS NOT NULL AND p_user=auth.uid()
 AND EXISTS(SELECT 1 FROM public.game_members m JOIN public.game_office_assignments a
  ON a.game_id=m.game_id AND a.user_id=m.user_id
  WHERE m.game_id=p_game AND m.user_id=p_user AND m.kind='student'
   AND m.roster_archived_at IS NULL AND a.status='active'
   AND a.role_title='Председатель Центрального банка Российской Федерации')
 AND private.role_is_available(p_game,p_user)
$f$;
REVOKE ALL ON FUNCTION private.can_issue_bank_rate_decision(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.formal_workflow(p_key text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
select case p_key
when 'bill' then '[
 {"code":"draft","label":"Черновик","owner":"author","action":"Внести в Государственную Думу"},
 {"code":"registered","label":"Зарегистрирован в ГД","owner":"gd_staff","action":"Направить в профильный комитет"},
 {"code":"committee","label":"Профильный комитет","owner":"committee","action":"Передать в Совет ГД"},
 {"code":"council","label":"Совет Государственной Думы","owner":"gd_council","action":"Назначить I чтение"},
 {"code":"reading1","label":"I чтение","owner":"gd","action":"Принять в I чтении"},
 {"code":"amendments","label":"Поправки и подготовка ко II чтению","owner":"committee","action":"Передать на II чтение"},
 {"code":"reading2","label":"II чтение","owner":"gd","action":"Принять во II чтении"},
 {"code":"reading3","label":"III чтение","owner":"gd","action":"Принять закон"},
 {"code":"sf","label":"Совет Федерации","owner":"sf","action":"Одобрить"},
 {"code":"president","label":"Президент Российской Федерации","owner":"president","action":"Подписать"},
 {"code":"published","label":"Подписан и опубликован","owner":"system","action":null}
]'::jsonb
when 'budget' then '[
 {"code":"draft","label":"Проект федерального бюджета","owner":"author","action":"Внести в Правительство"},
 {"code":"government","label":"Правительство / Минфин","owner":"government","action":"Внести проект в Государственную Думу"},
 {"code":"reading1","label":"I чтение бюджета","owner":"gd","action":"Принять основные характеристики"},
 {"code":"amendments","label":"Поправки ко II чтению","owner":"committee","action":"Передать на II чтение"},
 {"code":"reading2","label":"II чтение бюджета","owner":"gd","action":"Принять поправки"},
 {"code":"reading3","label":"III чтение бюджета","owner":"gd","action":"Принять бюджет в целом"},
 {"code":"sf","label":"Совет Федерации","owner":"sf","action":"Рассмотреть бюджет"},
 {"code":"president","label":"Президент Российской Федерации","owner":"president","action":"Подписать бюджет"},
 {"code":"published","label":"Подписан и опубликован","owner":"system","action":null}
]'::jsonb
when 'president_act' then '[
 {"code":"draft","label":"Проект акта Президента","owner":"author","action":"Передать на правовую подготовку"},
 {"code":"review","label":"Правовая подготовка","owner":"president","action":"Подписать Президентом"},
 {"code":"signed","label":"Подписан Президентом","owner":"president","action":"Направить на опубликование"},
 {"code":"published","label":"Официально опубликован","owner":"system","action":null}
]'::jsonb
when 'government_act' then '[
 {"code":"draft","label":"Проект акта Правительства","owner":"author","action":"Внести в Правительство"},
 {"code":"agenda","label":"В повестке Правительства","owner":"government","action":"Рассмотреть на заседании"},
 {"code":"adopted","label":"Принят Правительством","owner":"government","action":"Подписать и опубликовать"},
 {"code":"published","label":"Подписан и опубликован","owner":"system","action":null}
]'::jsonb
when 'gd_resolution' then '[
 {"code":"draft","label":"Проект постановления ГД","owner":"author","action":"Внести в Совет ГД"},
 {"code":"agenda","label":"В повестке Государственной Думы","owner":"gd_council","action":"Поставить на голосование"},
 {"code":"adopted","label":"Принято Государственной Думой","owner":"gd_staff","action":"Оформить и опубликовать"},
 {"code":"published","label":"Оформлено","owner":"system","action":null}
]'::jsonb
when 'sf_resolution' then '[
 {"code":"draft","label":"Проект постановления СФ","owner":"author","action":"Внести в Совет Федерации"},
 {"code":"agenda","label":"На рассмотрении Совета Федерации","owner":"sf","action":"Поставить на голосование"},
 {"code":"adopted","label":"Принято Советом Федерации","owner":"sf","action":"Оформить"},
 {"code":"published","label":"Оформлено","owner":"system","action":null}
]'::jsonb
when 'ministry_act' then '[
 {"code":"draft","label":"Проект ведомственного акта","owner":"author","action":"Передать на согласование"},
 {"code":"review","label":"Ведомственное согласование","owner":"ministry","action":"Подписать"},
 {"code":"signed","label":"Подписан министром","owner":"ministry","action":"Опубликовать"},
 {"code":"published","label":"Опубликован","owner":"system","action":null}
]'::jsonb
when 'municipal_act' then '[
 {"code":"draft","label":"Проект муниципального акта","owner":"author","action":"Внести на рассмотрение"},
 {"code":"meeting","label":"Рассмотрение муниципальным органом","owner":"municipality","action":"Принять"},
 {"code":"adopted","label":"Принят","owner":"municipality","action":"Оформить"},
 {"code":"published","label":"Оформлен","owner":"system","action":null}
]'::jsonb
when 'bank_rate' then '[
 {"code":"adopted","label":"Принято Советом директоров Банка России","owner":"central_bank","action":"Подписать Председателем Банка России"},
 {"code":"published","label":"Подписано и опубликовано","owner":"system","action":null}
]'::jsonb
else '[
 {"code":"draft","label":"Черновик","owner":"author","action":"Передать на рассмотрение"},
 {"code":"review","label":"На рассмотрении","owner":"teacher","action":"Принять"},
 {"code":"published","label":"Принят","owner":"system","action":null}
]'::jsonb end;
$function$
;

CREATE OR REPLACE FUNCTION private.matches_formal_owner(p_game uuid, p_user uuid, p_owner text, p_author uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select case
 when p_user is null or p_user is distinct from auth.uid() then false
 when p_owner='author' then p_user=p_author and exists(
   select 1 from public.game_members gm where gm.game_id=p_game
    and gm.user_id=p_user and gm.kind in ('student','teacher')
    and gm.roster_archived_at is null)
 when p_owner in ('system','teacher') then false
 when p_owner='central_bank' then private.can_issue_bank_rate_decision(p_game,p_user)
 when not exists(
   select 1 from public.game_members gm where gm.game_id=p_game
    and gm.user_id=p_user and gm.kind='student'
    and gm.roster_archived_at is null) then false
 when not private.role_is_available(p_game,p_user) then false
 else exists(select 1 from private.formal_user_roles(p_game,p_user) r where case p_owner
 when 'ksrf' then r like '%ксрф%'
 when 'ks' then r like '%конституционн%суд%'
 when 'vs' then r like '%верховн%суд%'
 when 'region' then r like '%законодательн%' or r like '%регион%'
 when 'president' then r like '%президент%'
 when 'gd_staff' then r like '%председател%' and r like '%дум%'
 when 'gd_council' then (r like '%совет%' or r like '%председател%') and r like '%дум%'
 when 'committee' then r like '%комитет%' or r like '%депутат%'
 when 'gd' then r like '%депутат%' or (r like '%государственн%' and r like '%дум%')
 when 'sf' then r like '%сенатор%' or r like '%совет федерац%'
 when 'government' then r like '%правительств%' or r like '%министр%'
 when 'ministry' then r like '%министр%' or r like '%министерств%'
 when 'municipality' then r like '%муницип%' or r like '%глава города%' or r like '%администрац%'
 else false end) end
$function$
;

CREATE OR REPLACE FUNCTION private.institution_document_signers(p_document uuid)
 RETURNS TABLE(user_id uuid, office text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE d public.formal_documents%rowtype;v_signer uuid;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document;
 IF d.id IS NULL OR d.status_code NOT IN ('published','adopted','signed') THEN RETURN; END IF;
 IF d.subject_key='ksrf' THEN
  RETURN QUERY SELECT DISTINCT p.leader_user_id,
    'Председатель фракции «'||p.name||'» (КСРФ)'::text
  FROM public.game_parties p
  JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.user_id=p.leader_user_id
  WHERE p.game_id=d.game_id AND p.registration_status='registered'
    AND gm.kind='student' AND gm.roster_archived_at IS NULL
  ORDER BY 1,2;
 ELSIF d.subject_key='central_bank' AND d.doc_type='bank_rate_decision' THEN
  SELECT s.signer_id INTO v_signer FROM public.formal_document_signatures s
   WHERE s.document_id=d.id ORDER BY s.signed_at LIMIT 1;
  IF v_signer IS NOT NULL THEN
   RETURN QUERY SELECT v_signer,'Председатель Банка России'::text;
  ELSE
   RETURN QUERY SELECT a.user_id,'Председатель Банка России'::text
    FROM public.game_office_assignments a
    JOIN public.game_members gm ON gm.game_id=a.game_id AND gm.user_id=a.user_id
    WHERE a.game_id=d.game_id AND a.user_id=d.author_id AND a.status='active'
      AND a.role_title='Председатель Центрального банка Российской Федерации'
      AND gm.kind='student' AND gm.roster_archived_at IS NULL LIMIT 1;
  END IF;
 ELSIF d.subject_key='gd' AND d.doc_type NOT IN ('fz_bill','fkz_bill','bill','federal_budget') THEN
  -- A signed GD act has exactly one authentic signatory. A later attendance
  -- change cannot replace the signature already attached to the act.
  SELECT s.signer_id INTO v_signer FROM public.formal_document_signatures s
   WHERE s.document_id=d.id
    AND s.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)
   ORDER BY s.signed_at,s.id LIMIT 1;
  IF v_signer IS NULL THEN v_signer:=private.gd_presiding_officer(d.game_id,d.stage_no); END IF;
  IF v_signer IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_signer,
   CASE WHEN EXISTS(SELECT 1 FROM public.game_office_assignments a
    WHERE a.game_id=d.game_id AND a.user_id=v_signer
      AND lower(btrim(a.role_title))='председатель государственной думы')
   THEN 'Председатель Государственной Думы Федерального Собрания Российской Федерации'::text
   ELSE 'Исполняющий обязанности Председателя Государственной Думы Федерального Собрания Российской Федерации'::text END;
 END IF;
END;$function$
;

CREATE OR REPLACE FUNCTION private.guard_formal_document_kind_route()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_expected text;v_kind text;
BEGIN
 v_expected:=CASE NEW.doc_type
  WHEN 'fz_bill' THEN 'bill' WHEN 'fkz_bill' THEN 'bill'
  WHEN 'federal_budget' THEN 'budget'
  WHEN 'president_decree' THEN 'president_act'
  WHEN 'president_order' THEN 'president_act'
  WHEN 'government_resolution' THEN 'government_act'
  WHEN 'government_order' THEN 'government_act'
  WHEN 'state_program' THEN 'government_act'
  WHEN 'gd_resolution' THEN 'gd_resolution'
  WHEN 'sf_resolution' THEN 'sf_resolution'
  WHEN 'ministry_order' THEN 'ministry_act'
  WHEN 'municipal_act' THEN 'municipal_act'
  WHEN 'bank_rate_decision' THEN 'bank_rate'
  WHEN 'other' THEN 'generic'
  WHEN 'justice_response' THEN 'official_correspondence'
  WHEN 'party_certificate' THEN 'official_correspondence'
  ELSE NULL
 END;
 v_kind:=coalesce(NEW.metadata->>'document_kind','');
 IF v_expected IS NOT NULL AND NEW.workflow_key IS DISTINCT FROM v_expected THEN
  RAISE EXCEPTION 'Вид документа не соответствует установленному маршруту рассмотрения'
    USING ERRCODE='23514';
 END IF;
 -- Institution-generated agendas and minutes use the dedicated meeting RPC.
 IF NEW.doc_type IN ('meeting_agenda','minutes') THEN
  IF v_kind NOT IN ('institution_meeting_agenda','duma_session_agenda','institution_meeting_minutes','government_session_agenda')
    OR NEW.workflow_key NOT IN ('gd_resolution','government_act')
    OR (v_kind='government_session_agenda' AND NOT (
       NEW.doc_type='meeting_agenda' AND NEW.workflow_key='government_act'
       AND NEW.subject_key='government' AND NEW.stage_no=11
       AND NEW.metadata->>'government_session_id'=nullif(current_setting('app.gos_government_agenda_session',true),'')
       AND EXISTS (select 1 from public.government_sessions s
        where s.id=(NEW.metadata->>'government_session_id')::uuid and s.game_id=NEW.game_id)
    ))
  THEN
   RAISE EXCEPTION 'Документы заседания оформляются только установленной процедурой'
     USING ERRCODE='23514';
  END IF;
 END IF;
 -- The old technical type "bill" may appear in history but must not be
 -- used to introduce a NEW legislative document.
 IF NEW.workflow_key='bill' AND NEW.doc_type NOT IN ('fz_bill','fkz_bill') THEN
  IF NOT (TG_OP='UPDATE' AND OLD.doc_type='bill'
   AND NEW.doc_type='bill' AND NEW.metadata->>'purpose'='presidential_electoral_system') THEN
   RAISE EXCEPTION 'Законодательный маршрут доступен только для ФЗ и ФКЗ'
     USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status_code IN ('rejected','superseded','withdrawn')
   AND auth.uid() IS NOT NULL
   AND (NEW.status_code IS DISTINCT FROM OLD.status_code
     OR NEW.current_step IS DISTINCT FROM OLD.current_step
     OR NEW.current_owner_key IS DISTINCT FROM OLD.current_owner_key
     OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
     OR NEW.workflow_key IS DISTINCT FROM OLD.workflow_key
     OR NEW.workflow_steps IS DISTINCT FROM OLD.workflow_steps)
 THEN
  RAISE EXCEPTION 'Отклонённый документ окончателен. Возобновление процедуры запрещено'
    USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$function$
;

CREATE OR REPLACE FUNCTION public.get_fiscal_context(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare answer jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджетной модели этой игры.';end if;
 perform private.ensure_fiscal_game(p_game_id);
 perform private.settle_monetary_inflation(p_game_id);
 if not exists(select 1 from budget_simulator_state where game_id=p_game_id) then perform private.ensure_budget_simulator(p_game_id);end if;
 -- Existing policy rows must never contend on ON CONFLICT during a read.
 -- The original INSERT remains the first-read path and is race-safe.
 if not exists (select 1 from game_fiscal_policy where game_id=p_game_id) then
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust,collection_lawfulness_reference)
 select p_game_id,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='economy'),50),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='public_trust'),50),
 (select value from state_metrics where game_id=p_game_id and metric_key='lawfulness')
 from game_fiscal_regions where game_id=p_game_id on conflict(game_id) do nothing;
 end if;
 select jsonb_build_object('policy',to_jsonb(p)||jsonb_build_object('budget_aux_anchor',coalesce(s.anchor->'aux_metrics','{}'::jsonb),'tax_activity_reference',coalesce((s.anchor->>'regional_activity_reference')::numeric,1),'fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end),'can_issue_bank_rate_decision',private.can_issue_bank_rate_decision(p_game_id,auth.uid()),'can_change_rate',private.is_game_teacher(p_game_id) or exists(
 select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.kind='student' and m.roster_archived_at is null
 and private.role_is_available(p_game_id,auth.uid())
 and (
   lower(coalesce(m.role_title,'')) ~ 'банк[а-я]* россии|центральн.{0,20}банк'
   or exists (
     select 1 from public.game_office_assignments a
     where a.game_id=p_game_id and a.user_id=m.user_id and a.status='active'
       and a.role_title='Председатель Центрального банка Российской Федерации'
   )
 )),
 'metrics',(select coalesce(jsonb_object_agg(metric_key,value),'{}') from state_metrics where game_id=p_game_id and (is_public or private.is_game_teacher(p_game_id))))
 into answer from game_fiscal_policy p left join budget_simulator_state s on s.game_id=p.game_id where p.game_id=p_game_id;
 return answer;
end$function$
;

CREATE OR REPLACE FUNCTION public.get_formal_document_tools(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();manage boolean;open_vote boolean;has_ballot boolean;editable boolean;signable boolean;next_step jsonb;president_editor boolean;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or not private.is_game_member(d.game_id) then raise exception 'Документ недоступен';end if;
 manage:=d.status_code NOT IN ('rejected','superseded','withdrawn') AND private.matches_formal_owner(d.game_id,u,d.current_owner_key,d.author_id);
 open_vote:=exists(select 1 from public.game_votes where formal_document_id=d.id and status='open');
 -- An opened ballot is not yet a cast vote. Editing stops permanently
 -- once ANY linked vote has a ballot (open or closed), even from another user.
 has_ballot:=exists(
   select 1 from public.game_votes v join public.game_ballots b on b.vote_id=v.id
   where v.formal_document_id=d.id
 );
 president_editor:=d.doc_type='president_decree' and d.subject_key='president' and d.workflow_key='president_act'
  and d.status_code in ('draft','review','revision','signed','published')
  and not private.is_game_teacher(d.game_id) and private.can_manage_presidential_policy(d.game_id,u);
 editable:=d.doc_type<>'bank_rate_decision' and not has_ballot and (private.is_game_teacher(d.game_id) or (manage and d.current_owner_key<>'system' and d.status_code not in ('signed','published','adopted','rejected')) or president_editor);
 next_step:=CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->(d.current_step+1) END;
 signable:=d.status_code NOT IN ('rejected','superseded','withdrawn') and not open_vote and not private.formal_vote_required(d) and (
  (manage and coalesce(d.workflow_steps->d.current_step->>'action','') ilike '%подпис%')
  or ((d.metadata->>'signed_by'=u::text) and d.status_code in ('signed','published','adopted')
   and d.metadata ? 'revision_changed_at'
   and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz))
  or (president_editor and d.status_code='signed' and d.metadata ? 'revision_changed_at'
   and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz))
 );
 return jsonb_build_object('can_edit',editable,'can_manage',manage,'can_sign',signable,
 'can_copy',exists(select 1 from public.game_members where game_id=d.game_id and user_id=u and kind<>'observer'),
 'vote_required',private.formal_vote_required(d),'open_vote',open_vote,'has_ballot',has_ballot,'next_owner',next_step->>'owner','next_action',CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->d.current_step->>'action' END);
end;$function$
;

CREATE OR REPLACE FUNCTION public.sign_institution_document(p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE d public.formal_documents%rowtype;v_uid uuid:=auth.uid();v_office text;v_signature text;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR v_uid IS NULL OR NOT private.is_game_member(d.game_id)
 THEN RAISE EXCEPTION 'Документ недоступен' USING ERRCODE='42501'; END IF;
 IF d.status_code NOT IN ('published','adopted','signed')
 THEN RAISE EXCEPTION 'Документ ещё не принят и не опубликован' USING ERRCODE='23514'; END IF;
 IF NOT private.role_is_available(d.game_id,v_uid)
 THEN RAISE EXCEPTION 'Полномочия подписанта недоступны' USING ERRCODE='42501'; END IF;
 SELECT s.office INTO v_office FROM private.institution_document_signers(d.id) s
 WHERE s.user_id=v_uid LIMIT 1;
 IF v_office IS NULL THEN RAISE EXCEPTION 'Подписание поручено другому уполномоченному лицу' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.formal_document_signatures s
   WHERE s.document_id=d.id
     AND (s.signer_id=v_uid OR d.subject_key='gd')
     AND s.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz))
 THEN RAISE EXCEPTION 'Эта редакция уже подписана уполномоченным лицом' USING ERRCODE='23505'; END IF;
 SELECT signature_path INTO v_signature FROM public.game_profiles
  WHERE game_id=d.game_id AND user_id=v_uid;
 IF nullif(v_signature,'') IS NULL
 THEN RAISE EXCEPTION 'Сначала сохраните изображение личной подписи в профиле' USING ERRCODE='23514'; END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,
  from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,v_uid,'Подписан документ уполномоченным лицом',
  d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,v_office);
 IF d.doc_type='bank_rate_decision' THEN
  IF d.status_code<>'adopted' THEN RAISE EXCEPTION 'Решение уже опубликовано';END IF;
  PERFORM set_config('app.gos_bank_rate_signed_id',d.id::text,true);
  UPDATE public.formal_documents SET status_code='published',status_label='Подписано и опубликовано',
   current_owner_key='system',current_step=1,updated_at=now() WHERE id=d.id;
  PERFORM set_config('app.gos_bank_rate_signed_id','',true);
  INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  VALUES(d.id,d.game_id,v_uid,'Опубликовано подписанное решение','adopted','published','central_bank','system',v_office);
 END IF;
 -- Исторический триггер capture_formal_document_signature сохраняет персональный
 -- снимок изображения и подпись в журнале без изменения содержания документа.
END;$function$
;

CREATE OR REPLACE FUNCTION public.advance_formal_document(p_document_id uuid, p_action text DEFAULT 'advance'::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 d public.formal_documents%rowtype;
 v_uid uuid:=(select auth.uid());
 v_next integer;
 v_step jsonb;
 v_from_status text;
 v_from_owner text;
 v_ready jsonb;
begin
 if p_action not in ('advance','return','reject') then raise exception 'Неизвестное действие';end if;
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if d.doc_type='bank_rate_decision' then raise exception 'Решение Банка России уже принято. Для подписания используйте карточку НПА.' using errcode='42501';end if;
 if d.status_code in ('rejected','superseded','withdrawn') then raise exception 'Документ отклонён или прекращён. Продолжение процедуры недоступно' using errcode='42501'; end if;
 if d.doc_type in ('meeting_agenda','minutes') and d.metadata->>'document_kind' in ('institution_meeting_agenda','duma_session_agenda','institution_meeting_minutes') then raise exception 'Повестка или протокол утверждается в разделе заседания, а не через маршрут постановления' using errcode='42501';end if;
 if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;
 if not private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id) then raise exception 'Current stage belongs to another institution'; end if;

 v_from_status:=d.status_code; v_from_owner:=d.current_owner_key;

 if p_action='return' then
  if d.workflow_key='budget' and d.status_code in ('budget_committee','budget_council') then
   v_next:=1;
   update public.formal_documents
   set current_step=v_next,status_code='revision',
       status_label='Возвращён Правительству на доработку',
       current_owner_key='government',updated_at=now()
   where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,v_uid,'Проект бюджета возвращён Правительству на доработку',v_from_status,'revision',v_from_owner,'government',p_note);
  else
   v_next:=0;v_step:=d.workflow_steps->v_next;
   update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на доработку',current_owner_key='author',updated_at=now() where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,v_uid,'Возвращён на доработку',v_from_status,'revision',v_from_owner,'author',p_note);
  end if;
 elsif p_action='reject' then
  update public.formal_documents set status_code='rejected',status_label='Отклонён',current_owner_key='system',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,'Отклонён',v_from_status,'rejected',v_from_owner,'system',p_note);
 else
  if d.workflow_key='bill' AND d.doc_type NOT IN ('fz_bill','fkz_bill')
     AND NOT (d.doc_type='bill' AND d.metadata->>'purpose'='presidential_electoral_system')
  THEN RAISE EXCEPTION 'Полная законодательная процедура предусмотрена только для ФЗ и ФКЗ' USING ERRCODE='42501'; END IF;
  if d.current_owner_key='president'
    and d.workflow_key in ('bill','budget','president_act')
    and not exists(
      select 1 from public.game_profiles gp where gp.game_id=d.game_id
       and gp.user_id=v_uid and nullif(gp.signature_path,'') is not null
    )
  then raise exception 'Президенту необходимо загрузить личную подпись в профиль перед подписанием' using errcode='23514';end if;
  if private.formal_vote_required(d) then raise exception 'Эта стадия завершается результатом голосования';end if;
  if exists(select 1 from public.game_votes where formal_document_id=d.id and status='open') then raise exception 'Сначала завершите открытое голосование';end if;
  if d.workflow_key='bill' and d.status_code in ('draft','revision') then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'submission_ready')::boolean,false)
   then raise exception 'Bill submission package is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  end if;
  if d.workflow_key='bill' and d.status_code='committee' then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'committee_ready')::boolean,false)
   then raise exception 'Committee review is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'review_issues')),'; '); end if;
  end if;
  if d.workflow_key='budget' and d.status_code='budget_committee'
     and not private.budget_preliminary_ready(d.id)
  then raise exception 'Complete the Budget Committee preliminary review before sending the project to the State Duma Council'; end if;

  v_next:=d.current_step+1;
  if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;
  v_step:=d.workflow_steps->v_next;
  update public.formal_documents
  set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
      current_owner_key=v_step->>'owner',updated_at=now()
  where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,coalesce(d.workflow_steps->d.current_step->>'action','Передан далее'),v_from_status,v_step->>'code',v_from_owner,v_step->>'owner',p_note);
 end if;
end;$function$
;

CREATE OR REPLACE FUNCTION public.delete_formal_document(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  d public.formal_documents%rowtype;
  v_teacher boolean;
  v_vote record;
  v_deleted boolean := false;
begin
  select * into d
  from public.formal_documents
  where id = p_document_id
  for update;

  if d.id is null or v_uid is null or not private.is_game_member(d.game_id) then
    raise exception 'Документ недоступен';
  end if;

  IF d.doc_type='bank_rate_decision' THEN raise exception 'Принятое решение по ключевой ставке нельзя удалить. Измените ставку новым решением Банка России.' using errcode='42501';END IF;
  v_teacher := private.is_game_teacher(d.game_id);

  if not (v_teacher or d.author_id = v_uid) then
    raise exception 'Удалить НПА может только его автор или преподаватель';
  end if;

  if exists (
    select 1
    from public.game_votes
    where formal_document_id = d.id
      and status = 'open'
  ) and not v_teacher then
    raise exception 'Сначала завершите или удалите открытое голосование по этому НПА';
  end if;

  if v_teacher then
    for v_vote in
      select id
      from public.game_votes
      where formal_document_id = d.id
        and status = 'open'
      order by opened_at
    loop
      perform public.delete_procedural_vote(v_vote.id);
    end loop;
  end if;

  delete from public.formal_documents
  where id = d.id;

  v_deleted := found;

  return jsonb_build_object(
    'deleted', v_deleted,
    'id', d.id,
    'registry_no', d.registry_no
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.adopt_bank_rate_decision(
 p_game_id uuid,p_new_rate numeric,p_expected_rate numeric,p_reason text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $api$
DECLARE v_uid uuid:=auth.uid();v_doc uuid;v_existing uuid;v_old numeric;v_no text;v_steps jsonb;
 v_stage integer;v_title text:='Решение Совета директоров Банка России о ключевой ставке';
 v_body text;v_meta jsonb;
BEGIN
 IF v_uid IS NULL OR NOT private.can_issue_bank_rate_decision(p_game_id,v_uid) THEN
  RAISE EXCEPTION 'Изменять ключевую ставку и принимать решение Банка России вправе только действующий Председатель Банка России' USING errcode='42501';END IF;
 IF p_request_id IS NULL OR p_new_rate IS NULL OR p_expected_rate IS NULL
   OR p_new_rate<0 OR p_new_rate>100 OR p_new_rate<>round(p_new_rate,2)
   OR p_reason IS NULL OR length(btrim(p_reason))<8 OR length(p_reason)>1500
 THEN RAISE EXCEPTION 'Укажите ставку от 0 до 100 процентов (до двух знаков после запятой) и основание не короче восьми символов' USING errcode='22023';END IF;
 PERFORM private.settle_monetary_inflation(p_game_id);
 SELECT p.key_rate INTO v_old FROM public.game_fiscal_policy p WHERE p.game_id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Финансовые параметры игры не найдены';END IF;
 SELECT d.id INTO v_existing FROM public.formal_documents d
  WHERE d.game_id=p_game_id AND d.doc_type='bank_rate_decision'
   AND d.author_id=v_uid AND d.metadata->>'bank_rate_request_id'=p_request_id::text LIMIT 1;
 IF v_existing IS NOT NULL THEN
  RETURN jsonb_build_object('document_id',v_existing,'rate',(SELECT (metadata->>'new_rate')::numeric FROM public.formal_documents WHERE id=v_existing),'already_adopted',true);END IF;
 IF v_old IS DISTINCT FROM p_expected_rate THEN RAISE EXCEPTION 'Ключевая ставка уже изменилась. Обновите показатели и подтвердите новое значение.' USING errcode='40001';END IF;
 IF v_old=p_new_rate THEN RAISE EXCEPTION 'Указанное значение совпадает с действующей ключевой ставкой.' USING errcode='22023';END IF;
 SELECT COALESCE((SELECT st.stage_no FROM public.game_stages st
  WHERE st.game_id=p_game_id AND st.status='open' ORDER BY st.stage_no DESC LIMIT 1),1) INTO v_stage;
 v_doc:=gen_random_uuid();v_no:='ГОС.ID-ЦБ-'||lpad(nextval('public.formal_registry_seq')::text,4,'0');
 v_steps:=private.formal_workflow('bank_rate');
 v_body:='СОВЕТ ДИРЕКТОРОВ БАНКА РОССИИ'||E'\n\n'||'РЕШИЛ:'||E'\n'||
 '1. Установить ключевую ставку Банка России на уровне '||replace(p_new_rate::text,'.',',')||' процента годовых.'||E'\n'||
 '2. Изменить ранее действовавшую ставку '||replace(v_old::text,'.',',')||' процента годовых. Решение применяется в экономической модели ГОС.ID с момента принятия.'||E'\n'||
 '3. Последствия денежно-кредитной политики рассчитываются по утверждённым правилам ГОС.ID.'||E'\n\n'||
 'Основание решения: '||btrim(p_reason)||E'\n\n'||'Председатель Банка России (подпись в реестре НПА).';
 v_meta:=jsonb_build_object('registry_independent',true,'bank_rate_decision',true,
  'bank_rate_request_id',p_request_id::text,'old_rate',v_old,'new_rate',p_new_rate,
  'issuer_name','Банк России','acting_user_id',v_uid,'place','Москва','authority','Совет директоров Банка России');
 PERFORM set_config('app.gos_registry_independent_id',v_doc::text,true);
 PERFORM set_config('app.gos_bank_rate_create_id',v_doc::text,true);
 INSERT INTO public.formal_documents
 (id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,
  workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
 VALUES(v_doc,p_game_id,v_stage,v_no,v_title,'bank_rate_decision','central_bank','Банк России',v_uid,v_body,
 'bank_rate',v_steps,0,'adopted','Принято Советом директоров Банка России','central_bank',v_meta);
 PERFORM set_config('app.gos_bank_rate_create_id','',true);
 PERFORM set_config('app.gos_registry_independent_id','',true);
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 VALUES(v_doc,p_game_id,v_uid,'Принято решение Совета директоров Банка России','adopted','central_bank',
 'Ставка: '||v_old||'% → '||p_new_rate||'%. Подписание Председателем Банка России ожидается.');
 PERFORM public.set_fiscal_policy(p_game_id,jsonb_build_object('key_rate',p_new_rate),
  'Решение Совета директоров Банка России № '||v_no||': '||btrim(p_reason));
 RETURN jsonb_build_object('document_id',v_doc,'rate',p_new_rate,'registry_no',v_no,'status','adopted');
END $api$;
REVOKE ALL ON FUNCTION public.adopt_bank_rate_decision(uuid,numeric,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.adopt_bank_rate_decision(uuid,numeric,numeric,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.guard_bank_rate_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $g$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.doc_type='bank_rate_decision' THEN RAISE EXCEPTION 'Решение Банка России сохраняется в реестре; для смены ставки нужно новое решение' USING errcode='42501';END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.doc_type='bank_rate_decision'
    AND (NEW.workflow_key<>'bank_rate' OR NEW.subject_key<>'central_bank'
     OR NEW.metadata->>'bank_rate_decision'<>'true'
     OR current_setting('app.gos_bank_rate_create_id',true) IS DISTINCT FROM NEW.id::text)
  THEN RAISE EXCEPTION 'Решения Банка России создаются только через защищённую процедуру изменения ставки' USING errcode='42501';END IF;
  RETURN NEW;
 END IF;
 IF OLD.doc_type='bank_rate_decision' OR NEW.doc_type='bank_rate_decision' THEN
  IF OLD.doc_type IS DISTINCT FROM NEW.doc_type OR OLD.game_id IS DISTINCT FROM NEW.game_id
    OR OLD.stage_no IS DISTINCT FROM NEW.stage_no OR OLD.author_id IS DISTINCT FROM NEW.author_id
    OR OLD.title IS DISTINCT FROM NEW.title OR OLD.body_text IS DISTINCT FROM NEW.body_text
    OR OLD.workflow_key IS DISTINCT FROM NEW.workflow_key OR OLD.workflow_steps IS DISTINCT FROM NEW.workflow_steps
    OR OLD.subject_key IS DISTINCT FROM NEW.subject_key OR OLD.registry_no IS DISTINCT FROM NEW.registry_no
    OR OLD.metadata->>'bank_rate_request_id' IS DISTINCT FROM NEW.metadata->>'bank_rate_request_id'
    OR OLD.metadata->>'new_rate' IS DISTINCT FROM NEW.metadata->>'new_rate'
    OR OLD.metadata->>'old_rate' IS DISTINCT FROM NEW.metadata->>'old_rate'
    OR OLD.metadata->>'registry_independent' IS DISTINCT FROM NEW.metadata->>'registry_independent'
  THEN RAISE EXCEPTION 'Принятое решение Банка России нельзя переписать; примите новое решение' USING errcode='42501';END IF;
  IF NEW.status_code IS DISTINCT FROM OLD.status_code OR NEW.current_step IS DISTINCT FROM OLD.current_step
   OR NEW.current_owner_key IS DISTINCT FROM OLD.current_owner_key THEN
   IF NOT (OLD.status_code='adopted' AND NEW.status_code='published' AND NEW.current_owner_key='system'
     AND NEW.current_step=1 AND current_setting('app.gos_bank_rate_signed_id',true)=OLD.id::text)
   THEN RAISE EXCEPTION 'Опубликование решения Банка России допускается только после личного подписания' USING errcode='42501';END IF;
  END IF;
 END IF;
 RETURN NEW;
END $g$;
REVOKE ALL ON FUNCTION private.guard_bank_rate_decision() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zzz_bank_rate_decision_guard ON public.formal_documents;
CREATE TRIGGER zzz_bank_rate_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.guard_bank_rate_decision();
