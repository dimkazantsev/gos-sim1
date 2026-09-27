-- Stage 12: verifiable bill submission package and committee conclusion.
create table if not exists public.bill_submission_profiles(
 document_id uuid primary key references public.formal_documents(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 requires_financial_justification boolean not null default false,
 requires_government_opinion boolean not null default false,
 committee_key text,
 representative_user_id uuid references auth.users(id) on delete set null,
 note text,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);

create table if not exists public.bill_package_files(
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.formal_documents(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 file_kind text not null check(file_kind in ('explanatory_note','affected_acts','financial_economic','government_opinion','collegial_decision','other_review')),
 title text not null,storage_path text not null,file_name text not null,mime_type text,file_size bigint,
 status text not null default 'submitted' check(status in ('submitted','accepted','revision')),
 note text,uploaded_by uuid not null references auth.users(id) on delete cascade,reviewed_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(document_id,file_kind)
);

create table if not exists public.bill_committee_conclusions(
 document_id uuid primary key references public.formal_documents(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 rapporteur_user_id uuid references auth.users(id) on delete set null,
 legal_compliance text not null default '',
 internal_logic text not null default '',
 affected_acts_completeness text not null default '',
 recommendation text not null default 'draft' check(recommendation in ('draft','proceed','return','reject')),
 finalized boolean not null default false,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);

create index if not exists bill_submission_profiles_game_idx on public.bill_submission_profiles(game_id);
create index if not exists bill_package_files_doc_idx on public.bill_package_files(document_id,status);
create index if not exists bill_committee_conclusions_game_idx on public.bill_committee_conclusions(game_id,finalized);
alter table public.bill_submission_profiles enable row level security;
alter table public.bill_package_files enable row level security;
alter table public.bill_committee_conclusions enable row level security;
revoke all privileges on table public.bill_submission_profiles from anon,authenticated;
revoke all privileges on table public.bill_package_files from anon,authenticated;
revoke all privileges on table public.bill_committee_conclusions from anon,authenticated;
grant select on table public.bill_submission_profiles to authenticated;
grant select on table public.bill_package_files to authenticated;
grant select on table public.bill_committee_conclusions to authenticated;
drop policy if exists bill_submission_profiles_read on public.bill_submission_profiles;
create policy bill_submission_profiles_read on public.bill_submission_profiles for select to authenticated using(private.is_game_member(game_id));
drop policy if exists bill_package_files_read on public.bill_package_files;
create policy bill_package_files_read on public.bill_package_files for select to authenticated using(private.is_game_member(game_id));
drop policy if exists bill_committee_conclusions_read on public.bill_committee_conclusions;
create policy bill_committee_conclusions_read on public.bill_committee_conclusions for select to authenticated using(private.is_game_member(game_id));

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bill_submission_profiles') then alter publication supabase_realtime add table public.bill_submission_profiles; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bill_package_files') then alter publication supabase_realtime add table public.bill_package_files; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bill_committee_conclusions') then alter publication supabase_realtime add table public.bill_committee_conclusions; end if;
end $$;

create or replace function private.is_bill_committee_member(p_document uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(
  select 1 from public.formal_documents d
  join public.bill_submission_profiles bp on bp.document_id=d.id
  join public.institution_units u on u.game_id=d.game_id and u.unit_kind='committee' and u.unit_key=bp.committee_key
  left join public.institution_assignments a on a.unit_id=u.id and a.user_id=p_user
  where d.id=p_document and (u.head_user_id=p_user or a.user_id=p_user)
 );
$$;
revoke execute on function private.is_bill_committee_member(uuid,uuid) from public,anon,authenticated;

create or replace function private.can_edit_bill_submission(p_document uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(
  select 1 from public.formal_documents d where d.id=p_document and d.workflow_key='bill' and (
    d.author_id=p_user or private.is_game_teacher(d.game_id)
    or private.matches_formal_owner(d.game_id,p_user,'gd_staff',d.author_id)
    or private.matches_formal_owner(d.game_id,p_user,'gd_council',d.author_id)
  )
 );
$$;
revoke execute on function private.can_edit_bill_submission(uuid,uuid) from public,anon,authenticated;

create or replace function private.can_review_bill_submission(p_document uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(
  select 1 from public.formal_documents d where d.id=p_document and d.workflow_key='bill' and (
    private.is_game_teacher(d.game_id) or private.is_bill_committee_member(d.id,p_user)
    or private.matches_formal_owner(d.game_id,p_user,'gd_staff',d.author_id)
    or private.matches_formal_owner(d.game_id,p_user,'gd_council',d.author_id)
  )
 );
$$;
revoke execute on function private.can_review_bill_submission(uuid,uuid) from public,anon,authenticated;

create or replace function public.save_bill_submission_profile(
 p_document_id uuid,p_requires_financial_justification boolean,p_requires_government_opinion boolean,
 p_committee_key text default null,p_representative_user_id uuid default null,p_note text default null
) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.workflow_key<>'bill' then raise exception 'Bill not found'; end if;
 if not private.can_edit_bill_submission(d.id,v_uid) then raise exception 'Bill dossier access required'; end if;
 if p_committee_key is not null and not exists(select 1 from public.institution_units where game_id=d.game_id and unit_kind='committee' and unit_key=p_committee_key) then raise exception 'Profile committee not found'; end if;
 if p_representative_user_id is not null and not exists(select 1 from public.game_members where game_id=d.game_id and user_id=p_representative_user_id) then raise exception 'Representative must be a game member'; end if;
 insert into public.bill_submission_profiles(document_id,game_id,requires_financial_justification,requires_government_opinion,committee_key,representative_user_id,note,updated_by,updated_at)
 values(d.id,d.game_id,coalesce(p_requires_financial_justification,false),coalesce(p_requires_government_opinion,false),nullif(trim(coalesce(p_committee_key,'')),''),p_representative_user_id,nullif(trim(coalesce(p_note,'')),''),v_uid,now())
 on conflict(document_id) do update set requires_financial_justification=excluded.requires_financial_justification,requires_government_opinion=excluded.requires_government_opinion,committee_key=excluded.committee_key,representative_user_id=excluded.representative_user_id,note=excluded.note,updated_by=v_uid,updated_at=now();
end;$$;
revoke all on function public.save_bill_submission_profile(uuid,boolean,boolean,text,uuid,text) from public,anon;
grant execute on function public.save_bill_submission_profile(uuid,boolean,boolean,text,uuid,text) to authenticated;

create or replace function public.add_bill_package_file(p_document_id uuid,p_file_kind text,p_title text,p_storage_path text,p_file_name text,p_mime_type text default null,p_file_size bigint default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.workflow_key<>'bill' then raise exception 'Bill not found'; end if;
 if d.author_id<>v_uid and not private.is_game_teacher(d.game_id) then raise exception 'Bill author / teacher access required'; end if;
 if p_file_kind not in ('explanatory_note','affected_acts','financial_economic','government_opinion','collegial_decision','other_review') then raise exception 'Unsupported bill package file kind'; end if;
 insert into public.bill_package_files(document_id,game_id,file_kind,title,storage_path,file_name,mime_type,file_size,uploaded_by,status,note,reviewed_by)
 values(d.id,d.game_id,p_file_kind,coalesce(nullif(trim(p_title),''),p_file_name),p_storage_path,p_file_name,p_mime_type,p_file_size,v_uid,'submitted',null,null)
 on conflict(document_id,file_kind) do update set title=excluded.title,storage_path=excluded.storage_path,file_name=excluded.file_name,mime_type=excluded.mime_type,file_size=excluded.file_size,uploaded_by=v_uid,status='submitted',note=null,reviewed_by=null,updated_at=now()
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.add_bill_package_file(uuid,text,text,text,text,text,bigint) from public,anon;
grant execute on function public.add_bill_package_file(uuid,text,text,text,text,text,bigint) to authenticated;

create or replace function public.review_bill_package_file(p_file_id uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare f public.bill_package_files%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into f from public.bill_package_files where id=p_file_id;
 if f.id is null then raise exception 'Bill package file not found'; end if;
 if not private.can_review_bill_submission(f.document_id,v_uid) then raise exception 'Committee / Duma staff / teacher access required'; end if;
 if p_status not in ('accepted','revision') then raise exception 'Unsupported review status'; end if;
 update public.bill_package_files set status=p_status,note=nullif(trim(coalesce(p_note,'')),''),reviewed_by=v_uid,updated_at=now() where id=f.id;
end;$$;
revoke all on function public.review_bill_package_file(uuid,text,text) from public,anon;
grant execute on function public.review_bill_package_file(uuid,text,text) to authenticated;

create or replace function public.save_bill_committee_conclusion(
 p_document_id uuid,p_rapporteur_user_id uuid,p_legal_compliance text,p_internal_logic text,p_affected_acts_completeness text,p_recommendation text,p_finalize boolean default false
) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.workflow_key<>'bill' then raise exception 'Bill not found'; end if;
 if not private.can_review_bill_submission(d.id,v_uid) then raise exception 'Profile committee / teacher access required'; end if;
 if p_recommendation not in ('draft','proceed','return','reject') then raise exception 'Unsupported committee recommendation'; end if;
 if p_finalize and (length(trim(coalesce(p_legal_compliance,'')))<10 or length(trim(coalesce(p_internal_logic,'')))<10 or length(trim(coalesce(p_affected_acts_completeness,'')))<10 or p_recommendation='draft')
 then raise exception 'Complete all three committee findings and choose a recommendation before finalizing'; end if;
 insert into public.bill_committee_conclusions(document_id,game_id,rapporteur_user_id,legal_compliance,internal_logic,affected_acts_completeness,recommendation,finalized,updated_by,updated_at)
 values(d.id,d.game_id,p_rapporteur_user_id,trim(coalesce(p_legal_compliance,'')),trim(coalesce(p_internal_logic,'')),trim(coalesce(p_affected_acts_completeness,'')),p_recommendation,p_finalize,v_uid,now())
 on conflict(document_id) do update set rapporteur_user_id=excluded.rapporteur_user_id,legal_compliance=excluded.legal_compliance,internal_logic=excluded.internal_logic,affected_acts_completeness=excluded.affected_acts_completeness,recommendation=excluded.recommendation,finalized=excluded.finalized,updated_by=v_uid,updated_at=now();
end;$$;
revoke all on function public.save_bill_committee_conclusion(uuid,uuid,text,text,text,text,boolean) from public,anon;
grant execute on function public.save_bill_committee_conclusion(uuid,uuid,text,text,text,text,boolean) to authenticated;

create or replace function private.bill_dossier_readiness_json(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;p public.bill_submission_profiles%rowtype;c public.bill_committee_conclusions%rowtype;issues jsonb:='[]'::jsonb;review_issues jsonb:='[]'::jsonb;v_kind text;required text[];
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.workflow_key<>'bill' then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Законопроект не найден')); end if;
 select * into p from public.bill_submission_profiles where document_id=d.id;
 select * into c from public.bill_committee_conclusions where document_id=d.id;
 if p.document_id is null then issues:=issues||jsonb_build_array('Не заполнена карточка внесения законопроекта');
 else
  if p.committee_key is null then issues:=issues||jsonb_build_array('Не определён профильный комитет'); end if;
  if p.representative_user_id is null and d.subject_key in ('government','sf','region','ks','vs') then issues:=issues||jsonb_build_array('Для коллегиального субъекта не указан представитель в Государственной Думе'); end if;
 end if;
 if nullif(trim(coalesce(d.body_text,'')),'') is null and d.source_file_path is null then issues:=issues||jsonb_build_array('Отсутствует текст законопроекта'); end if;
 required:=array['explanatory_note','affected_acts'];
 if coalesce(p.requires_financial_justification,false) then required:=array_append(required,'financial_economic'); end if;
 if coalesce(p.requires_government_opinion,false) then required:=array_append(required,'government_opinion'); end if;
 if d.subject_key in ('government','sf','region','ks','vs') then required:=array_append(required,'collegial_decision'); end if;
 foreach v_kind in array required loop
  if not exists(select 1 from public.bill_package_files where document_id=d.id and file_kind=v_kind) then issues:=issues||jsonb_build_array('Не приложен обязательный материал: '||v_kind); end if;
  if exists(select 1 from public.bill_package_files where document_id=d.id and file_kind=v_kind and status='revision') then review_issues:=review_issues||jsonb_build_array('Материал возвращён на доработку: '||v_kind); end if;
 end loop;
 if c.document_id is null or not c.finalized then review_issues:=review_issues||jsonb_build_array('Профильный комитет не завершил мотивированное заключение');
 elsif c.recommendation<>'proceed' then review_issues:=review_issues||jsonb_build_array('Заключение профильного комитета не рекомендует дальнейшее движение'); end if;
 return jsonb_build_object('submission_ready',jsonb_array_length(issues)=0,'committee_ready',jsonb_array_length(issues)=0 and jsonb_array_length(review_issues)=0,'issues',issues,'review_issues',review_issues,'required_files',to_jsonb(required),'committee_key',p.committee_key,'requires_financial_justification',coalesce(p.requires_financial_justification,false),'requires_government_opinion',coalesce(p.requires_government_opinion,false),'committee_recommendation',c.recommendation,'committee_finalized',coalesce(c.finalized,false));
end;$$;
revoke execute on function private.bill_dossier_readiness_json(uuid) from public,anon,authenticated;

create or replace function public.get_bill_dossier_readiness(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null then raise exception 'Document not found'; end if;
 if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;
 return private.bill_dossier_readiness_json(d.id);
end;$$;
revoke all on function public.get_bill_dossier_readiness(uuid) from public,anon;
grant execute on function public.get_bill_dossier_readiness(uuid) to authenticated;

create or replace function public.advance_formal_document(p_document_id uuid,p_action text default 'advance',p_note text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_next integer;v_step jsonb;v_from_status text;v_from_owner text;v_ready jsonb;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;
 if not private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id) then raise exception 'Current stage belongs to another institution'; end if;
 v_from_status:=d.status_code;v_from_owner:=d.current_owner_key;
 if p_action='return' then
  v_next:=0;v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на доработку',current_owner_key='author',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,'Возвращён на доработку',v_from_status,'revision',v_from_owner,'author',p_note);
 elsif p_action='reject' then
  update public.formal_documents set status_code='rejected',status_label='Отклонён',current_owner_key='system',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,'Отклонён',v_from_status,'rejected',v_from_owner,'system',p_note);
 else
  if d.workflow_key='bill' and d.status_code in ('draft','revision') then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'submission_ready')::boolean,false) then raise exception 'Bill submission package is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  end if;
  if d.workflow_key='bill' and d.status_code='committee' then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'committee_ready')::boolean,false) then raise exception 'Committee review is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'review_issues')),'; '); end if;
  end if;
  v_next:=d.current_step+1;
  if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;
  v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,coalesce(d.workflow_steps->d.current_step->>'action','Передан далее'),v_from_status,v_step->>'code',v_from_owner,v_step->>'owner',p_note);
 end if;
end;$$;
revoke all on function public.advance_formal_document(uuid,text,text) from public,anon;
grant execute on function public.advance_formal_document(uuid,text,text) to authenticated;