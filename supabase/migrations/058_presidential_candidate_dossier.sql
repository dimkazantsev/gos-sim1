-- Stage 6 presidential candidate dossier: program, registration package, self-nomination group and signatures.
create table if not exists public.presidential_candidate_program_points(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
 point_no integer not null check(point_no between 1 and 50),
 body text not null,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(candidate_id,point_no)
);
create table if not exists public.presidential_candidate_documents(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
 doc_kind text not null check(doc_kind in ('party_decision','party_egrul','group_petition','signature_sheets','consent','passport','income','real_estate','expenses')),
 title text not null,storage_path text not null,file_name text not null,mime_type text,file_size bigint,
 status text not null default 'submitted' check(status in ('submitted','accepted','revision')),
 note text,uploaded_by uuid not null references auth.users(id) on delete cascade,reviewed_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(candidate_id,doc_kind)
);
create table if not exists public.presidential_support_group(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
 supporter_user_id uuid not null references auth.users(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(candidate_id,supporter_user_id),unique(game_id,supporter_user_id)
);
create table if not exists public.presidential_signature_batches(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
 direction_label text not null,signatures integer not null check(signatures between 0 and 5),
 created_by uuid not null references auth.users(id) on delete cascade,
 updated_at timestamptz not null default now(),
 unique(candidate_id,direction_label)
);
create index if not exists presidential_program_points_candidate_idx on public.presidential_candidate_program_points(candidate_id,point_no);
create index if not exists presidential_documents_candidate_idx on public.presidential_candidate_documents(candidate_id,status);
create index if not exists presidential_support_candidate_idx on public.presidential_support_group(candidate_id);
create index if not exists presidential_signatures_candidate_idx on public.presidential_signature_batches(candidate_id);
alter table public.presidential_candidate_program_points enable row level security;
alter table public.presidential_candidate_documents enable row level security;
alter table public.presidential_support_group enable row level security;
alter table public.presidential_signature_batches enable row level security;
revoke all privileges on table public.presidential_candidate_program_points from anon,authenticated;
revoke all privileges on table public.presidential_candidate_documents from anon,authenticated;
revoke all privileges on table public.presidential_support_group from anon,authenticated;
revoke all privileges on table public.presidential_signature_batches from anon,authenticated;
grant select on table public.presidential_candidate_program_points to authenticated;
grant select on table public.presidential_candidate_documents to authenticated;
grant select on table public.presidential_support_group to authenticated;
grant select on table public.presidential_signature_batches to authenticated;
drop policy if exists presidential_program_points_read on public.presidential_candidate_program_points;
create policy presidential_program_points_read on public.presidential_candidate_program_points for select to authenticated using(private.is_game_member(game_id));
drop policy if exists presidential_documents_read on public.presidential_candidate_documents;
create policy presidential_documents_read on public.presidential_candidate_documents for select to authenticated using(private.is_game_member(game_id));
drop policy if exists presidential_support_group_read on public.presidential_support_group;
create policy presidential_support_group_read on public.presidential_support_group for select to authenticated using(private.is_game_member(game_id));
drop policy if exists presidential_signature_batches_read on public.presidential_signature_batches;
create policy presidential_signature_batches_read on public.presidential_signature_batches for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_candidate_program_points') then alter publication supabase_realtime add table public.presidential_candidate_program_points; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_candidate_documents') then alter publication supabase_realtime add table public.presidential_candidate_documents; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_support_group') then alter publication supabase_realtime add table public.presidential_support_group; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_signature_batches') then alter publication supabase_realtime add table public.presidential_signature_batches; end if;
end $$;

create or replace function private.can_manage_presidential_candidate(p_candidate uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(select 1 from public.presidential_candidates c where c.id=p_candidate and (
  private.is_game_teacher(c.game_id) or c.user_id=p_user or c.created_by=p_user or
  (c.party_id is not null and exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=p_user))
 ));
$$;
revoke execute on function private.can_manage_presidential_candidate(uuid,uuid) from public,anon,authenticated;

create or replace function public.save_presidential_program_point(p_candidate_id uuid,p_point_no integer,p_body text)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;if c.id is null then raise exception 'Candidate not found';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required';end if;
 if c.registration_status in ('registered','rejected','withdrawn') and not private.is_game_teacher(c.game_id) then raise exception 'Candidate dossier is locked';end if;
 if p_point_no<1 or p_point_no>50 then raise exception 'Program point number must be 1-50';end if;
 if length(trim(coalesce(p_body,'')))<5 then raise exception 'Program point is too short';end if;
 insert into public.presidential_candidate_program_points(game_id,candidate_id,point_no,body,created_by)
 values(c.game_id,c.id,p_point_no,trim(p_body),v_uid)
 on conflict(candidate_id,point_no) do update set body=excluded.body,updated_at=now()
 returning id into v_id;return v_id;
end;$$;
revoke all on function public.save_presidential_program_point(uuid,integer,text) from public,anon;
grant execute on function public.save_presidential_program_point(uuid,integer,text) to authenticated;

create or replace function public.delete_presidential_program_point(p_point_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_candidate_program_points%rowtype;c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.presidential_candidate_program_points where id=p_point_id;if p.id is null then return;end if;
 select * into c from public.presidential_candidates where id=p.candidate_id;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required';end if;
 if c.registration_status='registered' and not private.is_game_teacher(c.game_id) then raise exception 'Registered dossier is locked';end if;
 delete from public.presidential_candidate_program_points where id=p.id;
end;$$;
revoke all on function public.delete_presidential_program_point(uuid) from public,anon;
grant execute on function public.delete_presidential_program_point(uuid) to authenticated;

create or replace function public.add_presidential_candidate_document(p_candidate_id uuid,p_doc_kind text,p_title text,p_storage_path text,p_file_name text,p_mime_type text default null,p_file_size bigint default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;if c.id is null then raise exception 'Candidate not found';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required';end if;
 if p_doc_kind not in ('party_decision','party_egrul','group_petition','signature_sheets','consent','passport','income','real_estate','expenses') then raise exception 'Unsupported document kind';end if;
 if c.nomination_type='party' and p_doc_kind in ('group_petition','signature_sheets') then raise exception 'Self-nomination document is not applicable';end if;
 if c.nomination_type='self' and p_doc_kind in ('party_decision','party_egrul') then raise exception 'Party nomination document is not applicable';end if;
 if c.nomination_type='fictional' and not private.is_game_teacher(c.game_id) then raise exception 'Only teacher manages fictional candidate documents';end if;
 insert into public.presidential_candidate_documents(game_id,candidate_id,doc_kind,title,storage_path,file_name,mime_type,file_size,uploaded_by,status,note,reviewed_by)
 values(c.game_id,c.id,p_doc_kind,coalesce(nullif(trim(p_title),''),p_file_name),p_storage_path,p_file_name,p_mime_type,p_file_size,v_uid,'submitted',null,null)
 on conflict(candidate_id,doc_kind) do update set title=excluded.title,storage_path=excluded.storage_path,file_name=excluded.file_name,mime_type=excluded.mime_type,file_size=excluded.file_size,uploaded_by=v_uid,status='submitted',note=null,reviewed_by=null,updated_at=now()
 returning id into v_id;return v_id;
end;$$;
revoke all on function public.add_presidential_candidate_document(uuid,text,text,text,text,text,bigint) from public,anon;
grant execute on function public.add_presidential_candidate_document(uuid,text,text,text,text,text,bigint) to authenticated;

create or replace function public.review_presidential_candidate_document(p_document_id uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.presidential_candidate_documents%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into d from public.presidential_candidate_documents where id=p_document_id;if d.id is null then raise exception 'Document not found';end if;
 if not private.is_game_teacher(d.game_id) then raise exception 'Election commission / teacher access required';end if;
 if p_status not in ('accepted','revision') then raise exception 'Unsupported review status';end if;
 update public.presidential_candidate_documents set status=p_status,note=nullif(trim(coalesce(p_note,'')),''),reviewed_by=v_uid,updated_at=now() where id=d.id;
end;$$;
revoke all on function public.review_presidential_candidate_document(uuid,text,text) from public,anon;
grant execute on function public.review_presidential_candidate_document(uuid,text,text) to authenticated;

create or replace function public.add_presidential_supporter(p_candidate_id uuid,p_supporter_user_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;
 if c.id is null or c.nomination_type<>'self' then raise exception 'Support group is available only for self-nominated candidates';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required';end if;
 if not exists(select 1 from public.game_members where game_id=c.game_id and user_id=p_supporter_user_id and kind='student') then raise exception 'Supporter must be a student member of this game';end if;
 insert into public.presidential_support_group(game_id,candidate_id,supporter_user_id,created_by)
 values(c.game_id,c.id,p_supporter_user_id,v_uid) returning id into v_id;return v_id;
exception when unique_violation then raise exception 'This voter already belongs to a presidential self-nomination support group';
end;$$;
revoke all on function public.add_presidential_supporter(uuid,uuid) from public,anon;
grant execute on function public.add_presidential_supporter(uuid,uuid) to authenticated;

create or replace function public.remove_presidential_supporter(p_support_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare x public.presidential_support_group%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into x from public.presidential_support_group where id=p_support_id;if x.id is null then return;end if;
 if not private.can_manage_presidential_candidate(x.candidate_id,v_uid) then raise exception 'Candidate dossier access required';end if;
 delete from public.presidential_support_group where id=x.id;
end;$$;
revoke all on function public.remove_presidential_supporter(uuid) from public,anon;
grant execute on function public.remove_presidential_supporter(uuid) to authenticated;

create or replace function public.set_presidential_signature_batch(p_candidate_id uuid,p_direction_label text,p_signatures integer)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;
 if c.id is null or c.nomination_type<>'self' then raise exception 'Signature batches are available only for self-nominated candidates';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required';end if;
 if length(trim(coalesce(p_direction_label,'')))<2 then raise exception 'Institute direction is required';end if;
 if p_signatures<0 or p_signatures>5 then raise exception 'No more than 5 signatures per institute direction';end if;
 insert into public.presidential_signature_batches(game_id,candidate_id,direction_label,signatures,created_by)
 values(c.game_id,c.id,trim(p_direction_label),p_signatures,v_uid)
 on conflict(candidate_id,direction_label) do update set signatures=excluded.signatures,updated_at=now()
 returning id into v_id;return v_id;
end;$$;
revoke all on function public.set_presidential_signature_batch(uuid,text,integer) from public,anon;
grant execute on function public.set_presidential_signature_batch(uuid,text,integer) to authenticated;

create or replace function private.presidential_candidate_readiness_json(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_program integer;v_group integer;v_signatures integer;v_required text[];v_missing jsonb:='[]'::jsonb;v_kind text;v_accepted integer;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;
 if c.id is null then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Кандидат не найден'));end if;
 select count(*) into v_program from public.presidential_candidate_program_points where candidate_id=c.id;
 select count(*) into v_group from public.presidential_support_group where candidate_id=c.id;
 select coalesce(sum(signatures),0) into v_signatures from public.presidential_signature_batches where candidate_id=c.id;
 if c.nomination_type='party' then v_required:=array['party_decision','party_egrul','consent','passport','income','real_estate','expenses'];
 elsif c.nomination_type='self' then v_required:=array['group_petition','signature_sheets','consent','passport','income','real_estate','expenses'];
 else v_required:=array[]::text[];end if;
 if v_program<10 and c.nomination_type<>'fictional' then v_missing:=v_missing||jsonb_build_array('Программа содержит менее 10 положений');end if;
 foreach v_kind in array v_required loop
  if not exists(select 1 from public.presidential_candidate_documents where candidate_id=c.id and doc_kind=v_kind and status='accepted')
  then v_missing:=v_missing||jsonb_build_array('Не принят документ: '||v_kind);end if;
 end loop;
 if c.nomination_type='self' then
  if v_group<5 then v_missing:=v_missing||jsonb_build_array('В группе поддержки менее 5 избирателей');end if;
  if v_signatures<15 then v_missing:=v_missing||jsonb_build_array('Собрано менее 15 подписей');end if;
 end if;
 select count(*) into v_accepted from public.presidential_candidate_documents where candidate_id=c.id and status='accepted';
 return jsonb_build_object('ready',jsonb_array_length(v_missing)=0,'issues',v_missing,'program_points',v_program,'accepted_documents',v_accepted,'required_documents',cardinality(v_required),'support_group',v_group,'signatures',v_signatures,'nomination_type',c.nomination_type);
end;$$;
revoke execute on function private.presidential_candidate_readiness_json(uuid) from public,anon,authenticated;

create or replace function public.get_presidential_candidate_readiness(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;if c.id is null then raise exception 'Candidate not found';end if;
 if v_uid is null or not private.is_game_member(c.game_id) then raise exception 'Game access required';end if;
 return private.presidential_candidate_readiness_json(c.id);
end;$$;
revoke all on function public.get_presidential_candidate_readiness(uuid) from public,anon;
grant execute on function public.get_presidential_candidate_readiness(uuid) to authenticated;

create or replace function public.review_presidential_candidate(p_candidate_id uuid,p_status text,p_legal_errors integer,p_rating_penalty numeric)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_ready jsonb;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id for update;if c.id is null then raise exception 'Candidate not found';end if;
 if not private.is_game_teacher(c.game_id) then raise exception 'Teacher access required';end if;
 if p_status not in ('submitted','registered','revision','rejected','withdrawn') then raise exception 'Unsupported registration status';end if;
 if p_legal_errors<0 then raise exception 'Legal error count cannot be negative';end if;
 if p_rating_penalty<0 or p_rating_penalty>100 then raise exception 'Penalty must be 0-100';end if;
 if p_status='registered' then
  v_ready:=private.presidential_candidate_readiness_json(c.id);
  if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Candidate dossier is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; ');end if;
 end if;
 update public.presidential_candidates
 set registration_status=p_status,legal_error_count=p_legal_errors,rating_penalty=p_rating_penalty,
     registration_attempts=registration_attempts+case when p_status='revision' then 1 else 0 end,updated_at=now()
 where id=c.id;
end;$$;
revoke all on function public.review_presidential_candidate(uuid,text,integer,numeric) from public,anon;
grant execute on function public.review_presidential_candidate(uuid,text,integer,numeric) to authenticated;