create or replace function private.presidential_candidate_readiness_json(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_program integer;v_group integer;v_signatures integer;v_required text[];v_missing jsonb:='[]'::jsonb;v_kind text;v_accepted integer;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id and archived_at is null;
 if c.id is null then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Кандидат не найден'));end if;
 select count(*) into v_program from public.presidential_candidate_program_points where candidate_id=c.id;
 select count(*) into v_group from public.presidential_support_group where candidate_id=c.id;
 select coalesce(sum(signatures),0) into v_signatures from public.presidential_signature_batches where candidate_id=c.id;
 if c.nomination_type='party' then v_required:=array['party_decision','party_egrul','consent','passport','income','real_estate','expenses'];
 elsif c.nomination_type='self' then v_required:=array['group_petition','signature_sheets','consent','passport','income','real_estate','expenses'];
 else v_required:=array[]::text[];end if;
 if v_program<10 and c.nomination_type<>'fictional' then v_missing:=v_missing||jsonb_build_array('Программа содержит менее 10 положений');end if;
 foreach v_kind in array v_required loop
  if not exists(select 1 from public.presidential_candidate_documents where candidate_id=c.id and doc_kind=v_kind and archived_at is null and status='accepted')
  then v_missing:=v_missing||jsonb_build_array('Не принят документ: '||v_kind);end if;
 end loop;
 if c.nomination_type='self' then
  if v_group<5 then v_missing:=v_missing||jsonb_build_array('В группе поддержки менее 5 избирателей');end if;
  if v_signatures<15 then v_missing:=v_missing||jsonb_build_array('Собрано менее 15 подписей');end if;
 end if;
 select count(*) into v_accepted from public.presidential_candidate_documents where candidate_id=c.id and archived_at is null and status='accepted';
 return jsonb_build_object('ready',jsonb_array_length(v_missing)=0,'issues',v_missing,'program_points',v_program,'accepted_documents',v_accepted,'required_documents',cardinality(v_required),'support_group',v_group,'signatures',v_signatures,'nomination_type',c.nomination_type);
end;$$;
revoke execute on function private.presidential_candidate_readiness_json(uuid) from public,anon,authenticated;

create or replace function private.presidential_submission_review_json(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_required text[];v_kind text;v_doc public.presidential_candidate_documents%rowtype;
 items jsonb:='[]'::jsonb;issues jsonb:='[]'::jsonb;manual_count integer:=0;error_count integer:=0;
 v_program integer;v_group integer:=0;v_signatures integer:=0;v_verdict text;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id and archived_at is null;
 if c.id is null then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Кандидат не найден'));end if;
 if c.nomination_type='party' then v_required:=array['party_decision','party_egrul','consent','passport','income','real_estate','expenses'];
 elsif c.nomination_type='self' then v_required:=array['group_petition','signature_sheets','consent','passport','income','real_estate','expenses'];
 else v_required:=array[]::text[];end if;
 foreach v_kind in array v_required loop
  select * into v_doc from public.presidential_candidate_documents where candidate_id=c.id and doc_kind=v_kind and archived_at is null;
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
