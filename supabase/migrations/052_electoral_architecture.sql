-- Stages 2-3: electoral-system proposals, KSRF votes and 89-region allocation.
create table if not exists public.parliamentary_election_rules(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 system_type text not null check(system_type in ('proportional','majoritarian','mixed')),
 allocation_method text check(allocation_method in ('hare','droop','dhondt','sainte_lague','imperiali') or allocation_method is null),
 majoritarian_method text check(majoritarian_method in ('plurality','absolute_two_round') or majoritarian_method is null),
 proportional_share integer check(proportional_share between 0 and 100 or proportional_share is null),
 rationale text,status text not null default 'draft' check(status in ('draft','vote_open','adopted','rejected','superseded')),
 vote_id uuid references public.game_votes(id) on delete set null,proposed_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.regional_election_rules(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 method text not null check(method in ('random','proportional','agreement')),rationale text,
 status text not null default 'draft' check(status in ('draft','vote_open','adopted','rejected','allocated','superseded')),
 vote_id uuid references public.game_votes(id) on delete set null,proposed_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.regional_allocations(
 id uuid primary key default gen_random_uuid(),rule_id uuid not null references public.regional_election_rules(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,party_id uuid not null references public.game_parties(id) on delete cascade,
 regions integer not null default 0 check(regions>=0 and regions<=89),source text not null check(source in ('random','proportional','agreement')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(rule_id,party_id)
);
create index if not exists parliamentary_election_rules_game_idx on public.parliamentary_election_rules(game_id,created_at desc);
create index if not exists regional_election_rules_game_idx on public.regional_election_rules(game_id,created_at desc);
create index if not exists regional_allocations_rule_idx on public.regional_allocations(rule_id,party_id);
alter table public.parliamentary_election_rules enable row level security;
alter table public.regional_election_rules enable row level security;
alter table public.regional_allocations enable row level security;
revoke all privileges on table public.parliamentary_election_rules from anon,authenticated;
revoke all privileges on table public.regional_election_rules from anon,authenticated;
revoke all privileges on table public.regional_allocations from anon,authenticated;
grant select on table public.parliamentary_election_rules to authenticated;
grant select on table public.regional_election_rules to authenticated;
grant select on table public.regional_allocations to authenticated;
drop policy if exists parliamentary_election_rules_read on public.parliamentary_election_rules;
create policy parliamentary_election_rules_read on public.parliamentary_election_rules for select to authenticated using(private.is_game_member(game_id));
drop policy if exists regional_election_rules_read on public.regional_election_rules;
create policy regional_election_rules_read on public.regional_election_rules for select to authenticated using(private.is_game_member(game_id));
drop policy if exists regional_allocations_read on public.regional_allocations;
create policy regional_allocations_read on public.regional_allocations for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='parliamentary_election_rules') then alter publication supabase_realtime add table public.parliamentary_election_rules; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='regional_election_rules') then alter publication supabase_realtime add table public.regional_election_rules; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='regional_allocations') then alter publication supabase_realtime add table public.regional_allocations; end if;
end $$;
create or replace function private.can_propose_ksrf(p_game uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.is_game_teacher(p_game) or private.party_led_by(p_game,p_user) is not null;
$$;
revoke execute on function private.can_propose_ksrf(uuid,uuid) from public,anon,authenticated;
create or replace function public.propose_parliamentary_election_rule(p_game_id uuid,p_system_type text,p_allocation_method text default null,p_majoritarian_method text default null,p_proportional_share integer default null,p_rationale text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
 if v_uid is null or not private.can_propose_ksrf(p_game_id,v_uid) then raise exception 'Faction leader / teacher access required'; end if;
 if p_system_type not in ('proportional','majoritarian','mixed') then raise exception 'Unsupported electoral system'; end if;
 if p_system_type in ('proportional','mixed') and p_allocation_method not in ('hare','droop','dhondt','sainte_lague','imperiali') then raise exception 'Choose a quota or divisor allocation method'; end if;
 if p_system_type in ('majoritarian','mixed') and p_majoritarian_method not in ('plurality','absolute_two_round') then raise exception 'Choose a majoritarian rule'; end if;
 if p_system_type='mixed' and (p_proportional_share is null or p_proportional_share<=0 or p_proportional_share>=100) then raise exception 'Mixed system requires a proportional share from 1 to 99'; end if;
 insert into public.parliamentary_election_rules(game_id,system_type,allocation_method,majoritarian_method,proportional_share,rationale,proposed_by)
 values(p_game_id,p_system_type,p_allocation_method,p_majoritarian_method,p_proportional_share,nullif(trim(coalesce(p_rationale,'')),''),v_uid) returning id into v_id;return v_id;
end;$$;
revoke all on function public.propose_parliamentary_election_rule(uuid,text,text,text,integer,text) from public,anon;
grant execute on function public.propose_parliamentary_election_rule(uuid,text,text,text,integer,text) to authenticated;
create or replace function public.open_parliamentary_rule_vote(p_rule_id uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r public.parliamentary_election_rules%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;v_body text;
begin
 select * into r from public.parliamentary_election_rules where id=p_rule_id for update;if r.id is null then raise exception 'Electoral rule proposal not found';end if;
 if not private.can_propose_ksrf(r.game_id,v_uid) then raise exception 'Faction leader / teacher access required'; end if;
 if r.status<>'draft' then raise exception 'Proposal is not a draft'; end if;
 if exists(select 1 from public.game_votes where game_id=r.game_id and stage_no=2 and status='open') then raise exception 'Close the current stage 2 vote first';end if;
 v_body:='Система: '||r.system_type||coalesce('; метод распределения: '||r.allocation_method,'')||coalesce('; мажоритарное правило: '||r.majoritarian_method,'')||coalesce('; доля пропорциональной части: '||r.proportional_share||'%','')||coalesce('. Обоснование: '||r.rationale,'');
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(r.game_id,2,'КСРФ · избирательная система',v_body,'faction','open',v_uid,'factions','electoral_system','none',0,'yes_no_simple',0.5,true,false,'none','none') returning id into v_vote;
 update public.parliamentary_election_rules set status='vote_open',vote_id=v_vote,updated_at=now() where id=r.id;return v_vote;
end;$$;
revoke all on function public.open_parliamentary_rule_vote(uuid) from public,anon;
grant execute on function public.open_parliamentary_rule_vote(uuid) to authenticated;
create or replace function public.propose_regional_election_rule(p_game_id uuid,p_method text,p_rationale text default null) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
 if v_uid is null or not private.can_propose_ksrf(p_game_id,v_uid) then raise exception 'Faction leader / teacher access required';end if;
 if p_method not in ('random','proportional','agreement') then raise exception 'Unsupported regional allocation method';end if;
 insert into public.regional_election_rules(game_id,method,rationale,proposed_by) values(p_game_id,p_method,nullif(trim(coalesce(p_rationale,'')),''),v_uid) returning id into v_id;return v_id;
end;$$;
revoke all on function public.propose_regional_election_rule(uuid,text,text) from public,anon;
grant execute on function public.propose_regional_election_rule(uuid,text,text) to authenticated;
create or replace function public.open_regional_rule_vote(p_rule_id uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r public.regional_election_rules%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;v_label text;
begin
 select * into r from public.regional_election_rules where id=p_rule_id for update;if r.id is null then raise exception 'Regional rule proposal not found';end if;
 if not private.can_propose_ksrf(r.game_id,v_uid) then raise exception 'Faction leader / teacher access required';end if;
 if r.status<>'draft' then raise exception 'Proposal is not a draft';end if;
 if exists(select 1 from public.game_votes where game_id=r.game_id and stage_no=3 and status='open') then raise exception 'Close the current stage 3 vote first';end if;
 v_label:=case r.method when 'random' then 'демократический (случайный)' when 'proportional' then 'пропорциональный по мандатам ГД' else 'договорной' end;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(r.game_id,3,'КСРФ · метод распределения 89 субъектов','Предлагается метод: '||v_label||coalesce('. Обоснование: '||r.rationale,''),'faction','open',v_uid,'factions','regional_system','none',0,'yes_no_simple',0.5,true,false,'none','none') returning id into v_vote;
 update public.regional_election_rules set status='vote_open',vote_id=v_vote,updated_at=now() where id=r.id;return v_vote;
end;$$;
revoke all on function public.open_regional_rule_vote(uuid) from public,anon;
grant execute on function public.open_regional_rule_vote(uuid) to authenticated;
create or replace function private.electoral_rule_vote_trigger() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if new.status='closed' and old.status is distinct from new.status then
  if new.procedure_key='electoral_system' then
   if new.result_code='passed' then update public.parliamentary_election_rules set status='superseded',updated_at=now() where game_id=new.game_id and status='adopted';update public.parliamentary_election_rules set status='adopted',updated_at=now() where vote_id=new.id;
   else update public.parliamentary_election_rules set status='rejected',updated_at=now() where vote_id=new.id;end if;
  elsif new.procedure_key='regional_system' then
   if new.result_code='passed' then update public.regional_election_rules set status='superseded',updated_at=now() where game_id=new.game_id and status in ('adopted','allocated');update public.regional_election_rules set status='adopted',updated_at=now() where vote_id=new.id;
   else update public.regional_election_rules set status='rejected',updated_at=now() where vote_id=new.id;end if;
  end if;
 end if;return new;
end;$$;
revoke execute on function private.electoral_rule_vote_trigger() from public,anon,authenticated;
drop trigger if exists trg_electoral_rule_vote on public.game_votes;
create trigger trg_electoral_rule_vote after update of status on public.game_votes for each row execute function private.electoral_rule_vote_trigger();
create or replace function public.set_regional_agreement_allocation(p_rule_id uuid,p_party_id uuid,p_regions integer) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r public.regional_election_rules%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into r from public.regional_election_rules where id=p_rule_id for update;if r.id is null then raise exception 'Regional rule not found';end if;
 if r.method<>'agreement' or r.status<>'adopted' then raise exception 'Agreement allocation is not active';end if;
 if not private.is_game_teacher(r.game_id) and private.party_led_by(r.game_id,v_uid) is null then raise exception 'Faction leader / teacher access required';end if;
 if not exists(select 1 from public.game_parties where id=p_party_id and game_id=r.game_id) then raise exception 'Party not found';end if;
 if not private.is_game_teacher(r.game_id) and private.party_led_by(r.game_id,v_uid)<>p_party_id then raise exception 'Faction leader may edit only their own allocation proposal';end if;
 if p_regions<0 or p_regions>89 then raise exception 'Regions must be 0-89';end if;
 insert into public.regional_allocations(rule_id,game_id,party_id,regions,source) values(r.id,r.game_id,p_party_id,p_regions,'agreement')
 on conflict(rule_id,party_id) do update set regions=excluded.regions,updated_at=now();
end;$$;
revoke all on function public.set_regional_agreement_allocation(uuid,uuid,integer) from public,anon;
grant execute on function public.set_regional_agreement_allocation(uuid,uuid,integer) to authenticated;
create or replace function public.execute_regional_allocation(p_rule_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r public.regional_election_rules%rowtype;v_uid uuid:=(select auth.uid());i integer;v_party uuid;v_total integer;v_result jsonb;
begin
 select * into r from public.regional_election_rules where id=p_rule_id for update;if r.id is null then raise exception 'Regional rule not found';end if;
 if not private.is_game_teacher(r.game_id) then raise exception 'Teacher access required to finalize regional election results';end if;
 if r.status<>'adopted' then raise exception 'Regional method must be adopted first';end if;
 if r.method='random' then
  delete from public.regional_allocations where rule_id=r.id;
  for i in 1..89 loop
   select id into v_party from public.game_parties where game_id=r.game_id order by random() limit 1;
   if v_party is null then raise exception 'Create parties first';end if;
   insert into public.regional_allocations(rule_id,game_id,party_id,regions,source) values(r.id,r.game_id,v_party,1,'random')
   on conflict(rule_id,party_id) do update set regions=public.regional_allocations.regions+1,updated_at=now();
  end loop;
 elsif r.method='proportional' then
  if (select coalesce(sum(mandates),0) from public.game_parties where game_id=r.game_id)<=0 then raise exception 'Parliamentary mandates are required';end if;
  delete from public.regional_allocations where rule_id=r.id;
  with raw as (
   select id,mandates,mandates::numeric/(sum(mandates) over())*89 exact,floor(mandates::numeric/(sum(mandates) over())*89)::integer base
   from public.game_parties where game_id=r.game_id and mandates>0
  ),ranked as (
   select *,89-sum(base) over() extra,row_number() over(order by exact-base desc,id) rn from raw
  )
  insert into public.regional_allocations(rule_id,game_id,party_id,regions,source)
  select r.id,r.game_id,id,base+case when rn<=extra then 1 else 0 end,'proportional' from ranked;
 else
  select coalesce(sum(regions),0)::integer into v_total from public.regional_allocations where rule_id=r.id;
  if v_total<>89 then raise exception 'Agreement must distribute exactly 89 regions; current total: %',v_total;end if;
 end if;
 update public.game_parties p set regions=coalesce(a.regions,0) from (select party_id,regions from public.regional_allocations where rule_id=r.id) a where p.id=a.party_id and p.game_id=r.game_id;
 update public.game_parties set regions=0 where game_id=r.game_id and id not in(select party_id from public.regional_allocations where rule_id=r.id);
 update public.regional_election_rules set status='allocated',updated_at=now() where id=r.id;
 select coalesce(jsonb_agg(jsonb_build_object('party_id',a.party_id,'party_name',p.name,'regions',a.regions) order by a.regions desc,p.name),'[]'::jsonb)
 into v_result from public.regional_allocations a join public.game_parties p on p.id=a.party_id where a.rule_id=r.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(r.game_id,3,'Региональные выборы','notice','Распределены 89 законодательных органов субъектов РФ','Метод: '||r.method||'. Итог сохранён в партийных показателях.',v_uid);
 return v_result;
end;$$;
revoke all on function public.execute_regional_allocation(uuid) from public,anon;
grant execute on function public.execute_regional_allocation(uuid) to authenticated;