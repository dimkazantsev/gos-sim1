-- Stage 8: auditable Government formation workflow.
-- Separates the President's PM nomination, the Prime Minister's submissions to the Duma,
-- and Article 83(d.1) appointments after Federation Council consultation.

create table if not exists public.government_nominations(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null default 8,
  office_key text not null,
  office_title text not null,
  office_kind text not null check(office_kind in ('prime_minister','deputy_pm','duma_minister','security_minister','central_bank_chair')),
  route text not null check(route in ('president_to_duma','pm_to_duma','president_after_sf')),
  candidate_user_id uuid references auth.users(id) on delete set null,
  candidate_name text not null,
  attempt_no integer not null default 1 check(attempt_no between 1 and 10),
  status text not null default 'submitted'
    check(status in ('submitted','vote_open','approved','rejected','consultation_pending','consulted','appointed','withdrawn')),
  vote_id uuid references public.game_votes(id) on delete set null,
  nominated_by uuid not null references auth.users(id) on delete cascade,
  reviewed_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  appointed_at timestamptz
);

create index if not exists government_nominations_game_office_idx
  on public.government_nominations(game_id,office_key,created_at desc);
create index if not exists government_nominations_vote_idx
  on public.government_nominations(vote_id);

alter table public.government_nominations enable row level security;
revoke all privileges on table public.government_nominations from anon,authenticated;
grant select on table public.government_nominations to authenticated;
drop policy if exists government_nominations_read on public.government_nominations;
create policy government_nominations_read on public.government_nominations
for select to authenticated using(private.is_game_member(game_id));

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='government_nominations')
 then alter publication supabase_realtime add table public.government_nominations; end if;
end $$;

create or replace function private.game_role(p_game uuid,p_user uuid)
returns text
language sql stable security definer
set search_path=public,private,pg_temp
as $$
 select lower(coalesce(role_title,'')) from public.game_members where game_id=p_game and user_id=p_user limit 1;
$$;
revoke execute on function private.game_role(uuid,uuid) from public,anon,authenticated;

create or replace function public.submit_government_nomination(
 p_game_id uuid,p_office_key text,p_office_title text,p_office_kind text,p_candidate_user_id uuid,p_candidate_name text
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_role text;v_route text;v_attempt integer;v_id uuid;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_office_kind not in ('prime_minister','deputy_pm','duma_minister','security_minister','central_bank_chair') then raise exception 'Unsupported office kind'; end if;
 if length(trim(coalesce(p_office_key,'')))<2 or length(trim(coalesce(p_office_title,'')))<3 or length(trim(coalesce(p_candidate_name,'')))<3 then raise exception 'Office and candidate are required'; end if;
 if p_candidate_user_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_candidate_user_id and kind='student')
 then raise exception 'Candidate must be a game participant'; end if;
 v_role:=private.game_role(p_game_id,v_uid);

 if p_office_kind in ('prime_minister','central_bank_chair') then
   v_route:='president_to_duma';
   if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
 elsif p_office_kind in ('deputy_pm','duma_minister') then
   v_route:='pm_to_duma';
   if not private.is_game_teacher(p_game_id) and v_role not like '%председател%правительств%' then raise exception 'Prime Minister role required'; end if;
 else
   v_route:='president_after_sf';
   if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
 end if;

 select coalesce(max(attempt_no),0)+1 into v_attempt
 from public.government_nominations
 where game_id=p_game_id and office_key=trim(p_office_key);

 if v_attempt>3 and p_office_kind in ('prime_minister','deputy_pm','duma_minister') then
   raise exception 'Three Duma rejections have already been recorded for this office; resolve the constitutional consequence first';
 end if;

 insert into public.government_nominations(
  game_id,office_key,office_title,office_kind,route,candidate_user_id,candidate_name,attempt_no,status,nominated_by
 ) values(
  p_game_id,trim(p_office_key),trim(p_office_title),p_office_kind,v_route,p_candidate_user_id,trim(p_candidate_name),v_attempt,
  case when v_route='president_after_sf' then 'consultation_pending' else 'submitted' end,v_uid
 ) returning id into v_id;

 return v_id;
end;
$$;
revoke all on function public.submit_government_nomination(uuid,text,text,text,uuid,text) from public,anon;
grant execute on function public.submit_government_nomination(uuid,text,text,text,uuid,text) to authenticated;

create or replace function public.open_government_nomination_vote(p_nomination_id uuid)
returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare n public.government_nominations%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if not private.is_game_teacher(n.game_id) then raise exception 'Teacher access required'; end if;
 if n.route not in ('president_to_duma','pm_to_duma') or n.status<>'submitted' then raise exception 'This nomination is not ready for a Duma vote'; end if;

 insert into public.game_votes(
  game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,
  pass_transition,fail_transition
 ) values(
  n.game_id,8,'Утверждение кандидатуры · '||n.office_title,
  n.candidate_name||'. Для утверждения требуется большинство от общего числа депутатов Государственной Думы.',
  'mandate','open',v_uid,'gd','government_nomination',
  'fraction',0.5,'eligible_majority',0.5,true,false,'none','none'
 ) returning id into v_vote;

 update public.government_nominations set status='vote_open',vote_id=v_vote,updated_at=now() where id=n.id;
 return v_vote;
end;
$$;
revoke all on function public.open_government_nomination_vote(uuid) from public,anon;
grant execute on function public.open_government_nomination_vote(uuid) to authenticated;

create or replace function private.government_nomination_vote_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare n public.government_nominations%rowtype;v_rejections integer;
begin
 if new.status='closed' and old.status is distinct from new.status then
  select * into n from public.government_nominations where vote_id=new.id for update;
  if n.id is not null then
   if new.result_code='passed' then
    update public.government_nominations set status='approved',decided_at=now(),updated_at=now() where id=n.id;
   elsif new.result_code in ('rejected','no_quorum') then
    update public.government_nominations set status='rejected',decided_at=now(),updated_at=now() where id=n.id;
    select count(*)::integer into v_rejections from public.government_nominations
     where game_id=n.game_id and office_key=n.office_key and status='rejected';
    if v_rejections>=3 then
      insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
      values(n.game_id,8,'Формирование Правительства','critical','Третье отклонение кандидатуры · '||n.office_title,
       case when n.office_kind='prime_minister'
        then 'Зафиксировано три отклонения кандидатур Председателя Правительства. По ч. 4 ст. 111 Конституции РФ Президент назначает Председателя Правительства и вправе распустить Государственную Думу и назначить новые выборы.'
        else 'Зафиксировано три отклонения кандидатур по этой должности. Для заместителей Председателя Правительства и федеральных министров применяются последствия ч. 4 ст. 112 Конституции РФ; вопрос о роспуске ГД зависит также от доли оставшихся вакансий.'
       end,n.nominated_by);
    end if;
   end if;
  end if;
 end if;
 return new;
end;
$$;
revoke execute on function private.government_nomination_vote_trigger() from public,anon,authenticated;
drop trigger if exists trg_government_nomination_vote on public.game_votes;
create trigger trg_government_nomination_vote
after update of status on public.game_votes
for each row execute function private.government_nomination_vote_trigger();

create or replace function public.record_sf_consultation(p_nomination_id uuid,p_note text default null)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare n public.government_nominations%rowtype;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if not private.is_game_teacher(n.game_id) then raise exception 'Teacher / Federation Council simulation access required'; end if;
 if n.route<>'president_after_sf' or n.status<>'consultation_pending' then raise exception 'Consultation is not pending'; end if;
 update public.government_nominations set status='consulted',note=nullif(trim(coalesce(p_note,'')),''),reviewed_by=(select auth.uid()),decided_at=now(),updated_at=now() where id=n.id;
end;
$$;
revoke all on function public.record_sf_consultation(uuid,text) from public,anon;
grant execute on function public.record_sf_consultation(uuid,text) to authenticated;

create or replace function public.appoint_government_nominee(p_nomination_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare n public.government_nominations%rowtype;v_uid uuid:=(select auth.uid());v_role text;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 v_role:=private.game_role(n.game_id,v_uid);
 if not private.is_game_teacher(n.game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
 if n.route in ('president_to_duma','pm_to_duma') and n.status<>'approved' then raise exception 'Duma approval is required before appointment'; end if;
 if n.route='president_after_sf' and n.status<>'consulted' then raise exception 'Federation Council consultation must be recorded first'; end if;

 update public.government_nominations set status='appointed',appointed_at=now(),updated_at=now() where id=n.id;
 if n.candidate_user_id is not null then
  update public.game_members set role_title=n.office_title where game_id=n.game_id and user_id=n.candidate_user_id;
 end if;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,8,'Формирование Правительства','notice','Назначение · '||n.office_title,n.candidate_name,v_uid);
end;
$$;
revoke all on function public.appoint_government_nominee(uuid) from public,anon;
grant execute on function public.appoint_government_nominee(uuid) to authenticated;
