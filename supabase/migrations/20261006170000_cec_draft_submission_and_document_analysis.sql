-- CEC dossier workflow: editable drafts, text extraction results, preliminary checks and explicit submission.
alter table public.presidential_candidates
 add column if not exists cec_submitted_at timestamptz,
 add column if not exists cec_submission_version integer not null default 0;

alter table public.presidential_candidate_documents
 add column if not exists extracted_text text,
 add column if not exists extraction_status text not null default 'pending'
  check(extraction_status in ('pending','extracted','no_text','unsupported','error')),
 add column if not exists auto_check jsonb not null default '{}'::jsonb,
 add column if not exists is_submitted boolean not null default false,
 add column if not exists submitted_at timestamptz;

alter table public.presidential_cec_decisions
 add column if not exists reasoning jsonb not null default '{}'::jsonb;

create index if not exists presidential_documents_submission_idx
 on public.presidential_candidate_documents(candidate_id,is_submitted,doc_kind);

create or replace function private.presidential_doc_label(p_kind text)
returns text language sql immutable set search_path=pg_catalog as $$
 select case p_kind
  when 'party_decision' then 'Решение / протокол партии о выдвижении'
  when 'party_egrul' then 'Свидетельство ЕГРЮЛ о регистрации партии'
  when 'group_petition' then 'Ходатайство о регистрации группы избирателей'
  when 'signature_sheets' then 'Подписные листы'
  when 'consent' then 'Заявление о согласии баллотироваться'
  when 'passport' then 'Копия паспорта с изменёнными персональными данными'
  when 'income' then 'Сведения о доходах и их источниках'
  when 'real_estate' then 'Сведения о недвижимом имуществе'
  when 'expenses' then 'Сведения о расходах'
  else p_kind end
$$;
revoke execute on function private.presidential_doc_label(text) from public,anon,authenticated;

create or replace function private.presidential_document_check(p_kind text,p_text text,p_extraction_status text)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare t text:=lower(coalesce(p_text,''));issues jsonb:='[]'::jsonb;checks jsonb:='[]'::jsonb;v text:='ok';
begin
 if p_extraction_status in ('unsupported','no_text','error') or length(trim(t))<20 then
  return jsonb_build_object(
   'verdict','manual','summary','Текст автоматически не проверен. Требуется ручная проверка файла.',
   'issues',jsonb_build_array('Недостаточно распознанного текста для содержательной проверки.'),
   'checks',jsonb_build_array(),'basis','ФЗ № 19-ФЗ, гл. V; правила GOS//SIMS, этап 6'
  );
 end if;
 if p_kind='party_decision' then
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть решение/протокол','ok',(t like '%решен%' or t like '%протокол%')));
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Указано выдвижение кандидата','ok',t like '%выдвиж%'));
  if not (t like '%решен%' or t like '%протокол%') then issues:=issues||jsonb_build_array('Не найдено указание на решение или протокол.');end if;
  if not t like '%выдвиж%' then issues:=issues||jsonb_build_array('Не найдено указание на выдвижение кандидата.');end if;
 elsif p_kind='party_egrul' then
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть признаки регистрации / ЕГРЮЛ','ok',(t like '%егрюл%' or t like '%государственн%регистрац%' or t like '%огрн%')));
  if not (t like '%егрюл%' or t like '%государственн%регистрац%' or t like '%огрн%') then issues:=issues||jsonb_build_array('Не найдены признаки документа о государственной регистрации партии.');end if;
 elsif p_kind='group_petition' then
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Ходатайство о группе избирателей','ok',(t like '%ходатайств%' and t like '%групп%' and t like '%избират%')));
  if not (t like '%ходатайств%' and t like '%групп%' and t like '%избират%') then issues:=issues||jsonb_build_array('Не найдены ключевые реквизиты ходатайства о регистрации группы избирателей.');end if;
 elsif p_kind='signature_sheets' then
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть поля подписного листа','ok',(t like '%подпис%' and (t like '%фио%' or t like '%фамил%'))));
  if not (t like '%подпис%' and (t like '%фио%' or t like '%фамил%')) then issues:=issues||jsonb_build_array('Не распознаны обязательные признаки подписного листа.');end if;
 elsif p_kind='consent' then
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Согласие баллотироваться','ok',(t like '%соглас%' and t like '%баллотир%')));
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть сведения о кандидате','ok',(t like '%дата%рожд%' or t like '%место%рожд%' or t like '%гражданств%')));
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть сведения о месте работы / занятии','ok',(t like '%место%работ%' or t like '%род%занят%' or t like '%должност%')));
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть сведения о проживании','ok',(t like '%место%житель%' or t like '%адрес%' or t like '%прожив%')));
  if not (t like '%соглас%' and t like '%баллотир%') then issues:=issues||jsonb_build_array('Не найдено явно выраженное согласие баллотироваться.');end if;
  if not (t like '%дата%рожд%' or t like '%место%рожд%' or t like '%гражданств%') then issues:=issues||jsonb_build_array('Не распознаны базовые сведения о кандидате.');end if;
  if not (t like '%место%работ%' or t like '%род%занят%' or t like '%должност%') then issues:=issues||jsonb_build_array('Не распознаны сведения о работе, должности или роде занятий.');end if;
  if not (t like '%место%житель%' or t like '%адрес%' or t like '%прожив%') then issues:=issues||jsonb_build_array('Не распознаны сведения о месте жительства / проживании.');end if;
 elsif p_kind='passport' then
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть признаки документа, удостоверяющего личность','ok',(t like '%паспорт%' or t like '%документ%удостовер%')));
  if not (t like '%паспорт%' or t like '%документ%удостовер%') then issues:=issues||jsonb_build_array('Текст не позволяет подтвердить тип документа; требуется ручная проверка копии.');end if;
 elsif p_kind='income' then
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть сведения о доходах и источниках','ok',(t like '%доход%' and t like '%источник%')));
  if not (t like '%доход%' and t like '%источник%') then issues:=issues||jsonb_build_array('Не распознаны одновременно сведения о доходах и их источниках.');end if;
 elsif p_kind='real_estate' then
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть сведения об имуществе','ok',(t like '%имуществ%' or t like '%недвижим%' or t like '%собствен%')));
  if not (t like '%имуществ%' or t like '%недвижим%' or t like '%собствен%') then issues:=issues||jsonb_build_array('Не распознаны сведения о недвижимом имуществе / собственности.');end if;
 elsif p_kind='expenses' then
  checks:=checks||jsonb_build_array(jsonb_build_object('label','Есть сведения о расходах','ok',t like '%расход%'));
  if not t like '%расход%' then issues:=issues||jsonb_build_array('Не распознаны сведения о расходах.');end if;
 end if;
 if jsonb_array_length(issues)>0 then v:='issues';end if;
 return jsonb_build_object(
  'verdict',v,
  'summary',case when v='ok' then 'По распознанному тексту базовые признаки документа найдены.' else 'По распознанному тексту найдены замечания; нужна проверка и, при необходимости, исправление.' end,
  'issues',issues,'checks',checks,
  'basis','Предварительная проверка: ФЗ № 19-ФЗ, гл. V (ст. 34–39); правила GOS//SIMS, этап 6. Не заменяет решение ЦИК.'
 );
end;$$;
revoke execute on function private.presidential_document_check(text,text,text) from public,anon,authenticated;

create or replace function public.save_presidential_candidate_document_text(
 p_document_id uuid,p_text text,p_extraction_status text
) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.presidential_candidate_documents%rowtype;v_uid uuid:=(select auth.uid());v_check jsonb;
begin
 select * into d from public.presidential_candidate_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found';end if;
 if not private.can_manage_presidential_candidate(d.candidate_id,v_uid) then raise exception 'Candidate dossier access required';end if;
 if p_extraction_status not in ('pending','extracted','no_text','unsupported','error') then raise exception 'Unsupported extraction status';end if;
 v_check:=private.presidential_document_check(d.doc_kind,p_text,p_extraction_status);
 update public.presidential_candidate_documents
 set extracted_text=nullif(trim(coalesce(p_text,'')),''),extraction_status=p_extraction_status,auto_check=v_check,
     is_submitted=false,submitted_at=null,status='submitted',note=null,reviewed_by=null,updated_at=now()
 where id=d.id;
 return v_check;
end;$$;
revoke all on function public.save_presidential_candidate_document_text(uuid,text,text) from public,anon;
grant execute on function public.save_presidential_candidate_document_text(uuid,text,text) to authenticated;

create or replace function public.add_presidential_candidate_document(p_candidate_id uuid,p_doc_kind text,p_title text,p_storage_path text,p_file_name text,p_mime_type text default null,p_file_size bigint default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;if c.id is null then raise exception 'Candidate not found';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required';end if;
 if p_doc_kind not in ('party_decision','party_egrul','group_petition','signature_sheets','consent','passport','income','real_estate','expenses') then raise exception 'Unsupported document kind';end if;
 if c.nomination_type='party' and p_doc_kind in ('group_petition','signature_sheets') then raise exception 'Self-nomination document is not applicable';end if;
 if c.nomination_type='self' and p_doc_kind in ('party_decision','party_egrul') then raise exception 'Party nomination document is not applicable';end if;
 insert into public.presidential_candidate_documents(game_id,candidate_id,doc_kind,title,storage_path,file_name,mime_type,file_size,uploaded_by,status,note,reviewed_by,is_submitted,submitted_at,extracted_text,extraction_status,auto_check)
 values(c.game_id,c.id,p_doc_kind,coalesce(nullif(trim(p_title),''),p_file_name),p_storage_path,p_file_name,p_mime_type,p_file_size,v_uid,'submitted',null,null,false,null,null,'pending','{}'::jsonb)
 on conflict(candidate_id,doc_kind) do update set title=excluded.title,storage_path=excluded.storage_path,file_name=excluded.file_name,mime_type=excluded.mime_type,file_size=excluded.file_size,uploaded_by=v_uid,status='submitted',note=null,reviewed_by=null,is_submitted=false,submitted_at=null,extracted_text=null,extraction_status='pending',auto_check='{}'::jsonb,updated_at=now()
 returning id into v_id;return v_id;
end;$$;
revoke all on function public.add_presidential_candidate_document(uuid,text,text,text,text,text,bigint) from public,anon;
grant execute on function public.add_presidential_candidate_document(uuid,text,text,text,text,text,bigint) to authenticated;

create or replace function private.presidential_submission_review_json(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_required text[];v_kind text;v_doc public.presidential_candidate_documents%rowtype;
 items jsonb:='[]'::jsonb;issues jsonb:='[]'::jsonb;manual_count integer:=0;error_count integer:=0;
 v_program integer;v_group integer:=0;v_signatures integer:=0;v_verdict text;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;
 if c.id is null then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Кандидат не найден'));end if;
 if c.nomination_type='party' then v_required:=array['party_decision','party_egrul','consent','passport','income','real_estate','expenses'];
 elsif c.nomination_type='self' then v_required:=array['group_petition','signature_sheets','consent','passport','income','real_estate','expenses'];
 else v_required:=array[]::text[];end if;
 foreach v_kind in array v_required loop
  select * into v_doc from public.presidential_candidate_documents where candidate_id=c.id and doc_kind=v_kind;
  if v_doc.id is null then
   error_count:=error_count+1;issues:=issues||jsonb_build_array('Отсутствует: '||private.presidential_doc_label(v_kind));
   items:=items||jsonb_build_array(jsonb_build_object('kind',v_kind,'title',private.presidential_doc_label(v_kind),'state','missing','verdict','issues','issues',jsonb_build_array('Документ не загружен.')));
  else
   v_verdict:=coalesce(v_doc.auto_check->>'verdict','manual');
   if v_verdict='issues' then error_count:=error_count+1;end if;
   if v_verdict='manual' then manual_count:=manual_count+1;end if;
   items:=items||jsonb_build_array(jsonb_build_object('kind',v_kind,'title',private.presidential_doc_label(v_kind),'state',case when v_doc.is_submitted then 'submitted' else 'draft' end,'verdict',v_verdict,'issues',coalesce(v_doc.auto_check->'issues','[]'::jsonb),'summary',coalesce(v_doc.auto_check->>'summary','Проверка не выполнена.'),'file_name',v_doc.file_name));
  end if;
 end loop;
 select count(*) into v_program from public.presidential_candidate_program_points where candidate_id=c.id;
 if v_program<10 and c.nomination_type<>'fictional' then error_count:=error_count+1;issues:=issues||jsonb_build_array('Программа содержит менее 10 положений.');end if;
 if c.nomination_type='self' then
  select count(*) into v_group from public.presidential_support_group where candidate_id=c.id;
  select coalesce(sum(signatures),0) into v_signatures from public.presidential_signature_batches where candidate_id=c.id;
  if v_group<5 then error_count:=error_count+1;issues:=issues||jsonb_build_array('В учебной группе поддержки менее 5 участников.');end if;
  if v_signatures<15 then error_count:=error_count+1;issues:=issues||jsonb_build_array('В учебной модели собрано менее 15 подписей.');end if;
 end if;
 return jsonb_build_object('ready',error_count=0,'recommended_status',case when error_count=0 then 'registered' else 'revision' end,
  'error_count',error_count,'manual_count',manual_count,'issues',issues,'items',items,'program_points',v_program,'support_group',v_group,'signatures',v_signatures,
  'legal_basis',jsonb_build_array('Федеральный закон от 10.01.2003 № 19-ФЗ, глава V, статьи 34–39','Постановление ЦИК России от 22.11.2023 № 138/1056-8 — формы документов','Правила GOS//SIMS, этап 6 — учебная редукция требований'));
end;$$;
revoke execute on function private.presidential_submission_review_json(uuid) from public,anon,authenticated;

create or replace function public.get_presidential_cec_auto_review(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;
 if c.id is null then raise exception 'Candidate not found';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) and not (c.cec_submitted_at is not null and private.is_game_teacher(c.game_id))
 then raise exception 'Candidate dossier access required';end if;
 return private.presidential_submission_review_json(c.id);
end;$$;
revoke all on function public.get_presidential_cec_auto_review(uuid) from public,anon;
grant execute on function public.get_presidential_cec_auto_review(uuid) to authenticated;

create or replace function public.submit_presidential_candidate_to_cec(p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_review jsonb;v_was_submitted boolean;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id for update;
 if c.id is null then raise exception 'Candidate not found';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier owner access required';end if;
 if c.registration_status in ('registered','withdrawn') then raise exception 'Candidate dossier is locked';end if;
 v_review:=private.presidential_submission_review_json(c.id);
 if exists(select 1 from jsonb_array_elements(v_review->'items') x where x->>'state'='missing') then raise exception 'Complete the required document list before submission';end if;
 if coalesce((v_review->>'program_points')::int,0)<10 and c.nomination_type<>'fictional' then raise exception 'Program must contain at least 10 points';end if;
 if c.nomination_type='self' and (coalesce((v_review->>'support_group')::int,0)<5 or coalesce((v_review->>'signatures')::int,0)<15)
 then raise exception 'Self-nomination support requirements are incomplete';end if;
 v_was_submitted:=c.cec_submitted_at is not null;
 update public.presidential_candidate_documents set is_submitted=true,submitted_at=now(),status='submitted',updated_at=now() where candidate_id=c.id;
 update public.presidential_candidates set cec_submitted_at=now(),cec_submission_version=cec_submission_version+1,
   registration_status='submitted',registration_attempts=registration_attempts+case when v_was_submitted then 1 else 0 end,updated_at=now() where id=c.id;
 return private.presidential_submission_review_json(c.id);
end;$$;
revoke all on function public.submit_presidential_candidate_to_cec(uuid) from public,anon;
grant execute on function public.submit_presidential_candidate_to_cec(uuid) to authenticated;

drop policy if exists presidential_candidates_read on public.presidential_candidates;
create policy presidential_candidates_read on public.presidential_candidates for select to authenticated using(
 private.is_game_member(game_id) and (
  cec_submitted_at is not null or user_id=(select auth.uid()) or created_by=(select auth.uid()) or
  exists(select 1 from public.game_parties p where p.id=party_id and p.leader_user_id=(select auth.uid()))
 )
);

drop policy if exists presidential_program_points_read on public.presidential_candidate_program_points;
create policy presidential_program_points_read on public.presidential_candidate_program_points for select to authenticated using(
 exists(select 1 from public.presidential_candidates c where c.id=candidate_id and (
   c.cec_submitted_at is not null or c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
   exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid()))
 ))
);

drop policy if exists presidential_documents_read on public.presidential_candidate_documents;
create policy presidential_documents_read on public.presidential_candidate_documents for select to authenticated using(
 exists(select 1 from public.presidential_candidates c where c.id=candidate_id and (
   c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
   exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid())) or
   (presidential_candidate_documents.is_submitted and private.is_game_teacher(game_id))
 ))
);

drop policy if exists presidential_support_group_read on public.presidential_support_group;
create policy presidential_support_group_read on public.presidential_support_group for select to authenticated using(
 exists(select 1 from public.presidential_candidates c where c.id=candidate_id and (
  c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
  exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid())) or
  (c.cec_submitted_at is not null and private.is_game_teacher(game_id))
 ))
);

drop policy if exists presidential_signature_batches_read on public.presidential_signature_batches;
create policy presidential_signature_batches_read on public.presidential_signature_batches for select to authenticated using(
 exists(select 1 from public.presidential_candidates c where c.id=candidate_id and (
  c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
  exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid())) or
  (c.cec_submitted_at is not null and private.is_game_teacher(game_id))
 ))
);

drop policy if exists presidential_candidate_private_profiles_read on public.presidential_candidate_private_profiles;
create policy presidential_candidate_private_profiles_read on public.presidential_candidate_private_profiles for select to authenticated using(
 exists(select 1 from public.presidential_candidates c where c.id=candidate_id and (
  c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
  exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid())) or
  (c.cec_submitted_at is not null and private.is_game_teacher(game_id))
 ))
);
