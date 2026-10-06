-- CEC workflow and privacy hardening for presidential stages 6–7.
alter table public.presidential_candidates
  add column if not exists campaign_statement text,
  add column if not exists registration_number text,
  add column if not exists registration_decision_no text,
  add column if not exists registration_decision_at timestamptz,
  add column if not exists registration_public_summary text;

create sequence if not exists public.presidential_cec_decision_seq;

create table if not exists public.presidential_cec_decisions(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
  decision_type text not null check(decision_type in ('registered','revision','rejected','withdrawn')),
  decision_number text not null unique,
  public_summary text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists presidential_cec_decisions_game_created_idx on public.presidential_cec_decisions(game_id,created_at desc);
create index if not exists presidential_cec_decisions_candidate_idx on public.presidential_cec_decisions(candidate_id,created_at desc);

create table if not exists public.presidential_cec_private_notes(
  decision_id uuid primary key references public.presidential_cec_decisions(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
  private_summary text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists presidential_cec_private_notes_candidate_idx on public.presidential_cec_private_notes(candidate_id,created_at desc);

create table if not exists public.presidential_candidate_private_profiles(
  candidate_id uuid primary key references public.presidential_candidates(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  birth_date date,
  birth_place text,
  contact_phone text,
  contact_email text,
  address_text text,
  passport_note text,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.presidential_cec_decisions enable row level security;
alter table public.presidential_cec_private_notes enable row level security;
alter table public.presidential_candidate_private_profiles enable row level security;
revoke all privileges on table public.presidential_cec_decisions from anon,authenticated;
revoke all privileges on table public.presidential_cec_private_notes from anon,authenticated;
revoke all privileges on table public.presidential_candidate_private_profiles from anon,authenticated;
grant select on table public.presidential_cec_decisions to authenticated;
grant select on table public.presidential_cec_private_notes to authenticated;
grant select on table public.presidential_candidate_private_profiles to authenticated;

drop policy if exists presidential_cec_decisions_read on public.presidential_cec_decisions;
create policy presidential_cec_decisions_read on public.presidential_cec_decisions for select to authenticated
using(private.is_game_member(game_id));

drop policy if exists presidential_cec_private_notes_read on public.presidential_cec_private_notes;
create policy presidential_cec_private_notes_read on public.presidential_cec_private_notes for select to authenticated
using(private.is_game_teacher(game_id) or exists(
  select 1 from public.presidential_candidates c
  where c.id=candidate_id and (
    c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
    exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid()))
  )
));

drop policy if exists presidential_candidate_private_profiles_read on public.presidential_candidate_private_profiles;
create policy presidential_candidate_private_profiles_read on public.presidential_candidate_private_profiles for select to authenticated
using(private.is_game_teacher(game_id) or exists(
  select 1 from public.presidential_candidates c
  where c.id=candidate_id and (
    c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
    exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid()))
  )
));

drop policy if exists presidential_documents_read on public.presidential_candidate_documents;
create policy presidential_documents_read on public.presidential_candidate_documents for select to authenticated
using(private.is_game_teacher(game_id) or exists(
  select 1 from public.presidential_candidates c
  where c.id=candidate_id and (
    c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
    exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid()))
  )
));

drop policy if exists presidential_support_group_read on public.presidential_support_group;
create policy presidential_support_group_read on public.presidential_support_group for select to authenticated
using(private.is_game_teacher(game_id) or exists(
  select 1 from public.presidential_candidates c
  where c.id=candidate_id and (
    c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
    exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid()))
  )
));

drop policy if exists presidential_signature_batches_read on public.presidential_signature_batches;
create policy presidential_signature_batches_read on public.presidential_signature_batches for select to authenticated
using(private.is_game_teacher(game_id) or exists(
  select 1 from public.presidential_candidates c
  where c.id=candidate_id and (
    c.user_id=(select auth.uid()) or c.created_by=(select auth.uid()) or
    exists(select 1 from public.game_parties p where p.id=c.party_id and p.leader_user_id=(select auth.uid()))
  )
));

create or replace function public.save_presidential_public_profile(
 p_candidate_id uuid,p_program_summary text,p_campaign_statement text
) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into c from public.presidential_candidates where id=p_candidate_id for update;
 if c.id is null then raise exception 'Candidate not found'; end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required'; end if;
 update public.presidential_candidates set
   program_summary=nullif(trim(coalesce(p_program_summary,'')),''),
   campaign_statement=nullif(trim(coalesce(p_campaign_statement,'')),''),
   updated_at=now()
 where id=c.id;
end;$$;
revoke all on function public.save_presidential_public_profile(uuid,text,text) from public,anon;
grant execute on function public.save_presidential_public_profile(uuid,text,text) to authenticated;

create or replace function public.save_presidential_private_profile(
 p_candidate_id uuid,p_birth_date date,p_birth_place text,p_contact_phone text,p_contact_email text,p_address_text text,p_passport_note text
) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;
 if c.id is null then raise exception 'Candidate not found'; end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required'; end if;
 insert into public.presidential_candidate_private_profiles(candidate_id,game_id,birth_date,birth_place,contact_phone,contact_email,address_text,passport_note,updated_by)
 values(c.id,c.game_id,p_birth_date,nullif(trim(coalesce(p_birth_place,'')),''),nullif(trim(coalesce(p_contact_phone,'')),''),nullif(trim(coalesce(p_contact_email,'')),''),nullif(trim(coalesce(p_address_text,'')),''),nullif(trim(coalesce(p_passport_note,'')),''),v_uid)
 on conflict(candidate_id) do update set birth_date=excluded.birth_date,birth_place=excluded.birth_place,contact_phone=excluded.contact_phone,contact_email=excluded.contact_email,address_text=excluded.address_text,passport_note=excluded.passport_note,updated_by=v_uid,updated_at=now();
end;$$;
revoke all on function public.save_presidential_private_profile(uuid,date,text,text,text,text,text) from public,anon;
grant execute on function public.save_presidential_private_profile(uuid,date,text,text,text,text,text) to authenticated;

create or replace function public.get_presidential_candidate_readiness(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;
 if c.id is null then raise exception 'Candidate not found'; end if;
 if v_uid is null or not private.is_game_member(c.game_id) then raise exception 'Game access required'; end if;
 if not private.is_game_teacher(c.game_id) and not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required'; end if;
 return private.presidential_candidate_readiness_json(c.id);
end;$$;
revoke all on function public.get_presidential_candidate_readiness(uuid) from public,anon;
grant execute on function public.get_presidential_candidate_readiness(uuid) to authenticated;

create or replace function public.record_presidential_cec_decision(
 p_candidate_id uuid,p_status text,p_legal_errors integer,p_rating_penalty numeric,p_public_summary text,p_private_summary text
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_ready jsonb;v_id uuid;v_seq bigint;v_decision_no text;v_registration_no text;v_public text;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id for update;
 if c.id is null then raise exception 'Candidate not found'; end if;
 if not private.is_game_teacher(c.game_id) then raise exception 'Election commission / teacher access required'; end if;
 if p_status not in ('registered','revision','rejected','withdrawn') then raise exception 'Unsupported CEC decision'; end if;
 if p_legal_errors<0 then raise exception 'Legal error count cannot be negative'; end if;
 if p_rating_penalty<0 or p_rating_penalty>100 then raise exception 'Penalty must be 0-100'; end if;
 if p_status='registered' then
   v_ready:=private.presidential_candidate_readiness_json(c.id);
   if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Candidate dossier is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; ');end if;
 end if;
 v_seq:=nextval('public.presidential_cec_decision_seq');
 v_decision_no:='ЦИК-'||to_char(current_date,'YYYY')||'-'||lpad(v_seq::text,4,'0');
 v_registration_no:=case when p_status='registered' then 'КП-'||to_char(current_date,'YYYY')||'-'||lpad(v_seq::text,4,'0') else c.registration_number end;
 v_public:=coalesce(nullif(trim(coalesce(p_public_summary,'')),''),
   case p_status when 'registered' then 'Кандидат зарегистрирован. Представленный комплект документов соответствует редуцированным правилам игры.'
   when 'revision' then 'Документы возвращены на доработку. После устранения замечаний возможна повторная подача.'
   when 'rejected' then 'В регистрации отказано по результатам проверки представленного комплекта.'
   else 'Кандидат снят с процедуры.' end);
 insert into public.presidential_cec_decisions(game_id,candidate_id,decision_type,decision_number,public_summary,created_by)
 values(c.game_id,c.id,p_status,v_decision_no,v_public,v_uid) returning id into v_id;
 insert into public.presidential_cec_private_notes(decision_id,game_id,candidate_id,private_summary,created_by)
 values(v_id,c.game_id,c.id,nullif(trim(coalesce(p_private_summary,'')),''),v_uid);
 update public.presidential_candidates set registration_status=p_status,legal_error_count=p_legal_errors,rating_penalty=p_rating_penalty,
   registration_attempts=registration_attempts+case when p_status='revision' then 1 else 0 end,
   registration_number=v_registration_no,registration_decision_no=v_decision_no,registration_decision_at=now(),
   registration_public_summary=v_public,updated_at=now()
 where id=c.id;
 return v_id;
end;$$;
revoke all on function public.record_presidential_cec_decision(uuid,text,integer,numeric,text,text) from public,anon;
grant execute on function public.record_presidential_cec_decision(uuid,text,integer,numeric,text,text) to authenticated;

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_cec_decisions')
 then alter publication supabase_realtime add table public.presidential_cec_decisions; end if;
end $$;
