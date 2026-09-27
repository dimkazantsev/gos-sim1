-- Stage 7: State Duma chooses the presidential electoral system; Federation Council appoints the election.
create table if not exists public.presidential_system_proposals(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 system_type text not null check(system_type in ('relative','absolute','qualified','preferential')),
 threshold_pct numeric check(threshold_pct is null or threshold_pct between 0 and 100),
 rationale text,
 status text not null default 'draft' check(status in ('draft','vote_open','adopted','rejected','superseded')),
 vote_id uuid references public.game_votes(id) on delete set null,
 proposed_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists presidential_system_proposals_game_idx on public.presidential_system_proposals(game_id,created_at desc);
alter table public.presidential_system_proposals enable row level security;
revoke all privileges on table public.presidential_system_proposals from anon,authenticated;
grant select on table public.presidential_system_proposals to authenticated;
drop policy if exists presidential_system_proposals_read on public.presidential_system_proposals;
create policy presidential_system_proposals_read on public.presidential_system_proposals for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_system_proposals')
 then alter publication supabase_realtime add table public.presidential_system_proposals; end if;
end $$;

create or replace function private.can_manage_presidential_system_vote(p_game uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.is_game_teacher(p_game) or private.party_led_by(p_game,p_user) is not null
    or private.game_role(p_game,p_user) like '%председател%дум%' or private.game_role(p_game,p_user) like '%совет%дум%';
$$;
revoke execute on function private.can_manage_presidential_system_vote(uuid,uuid) from public,anon,authenticated;

create or replace function public.propose_presidential_system(p_game_id uuid,p_system_type text,p_threshold_pct numeric default null,p_rationale text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 if private.party_led_by(p_game_id,v_uid) is null and not private.is_game_teacher(p_game_id) then raise exception 'Faction leader / teacher access required';end if;
 if p_system_type not in ('relative','absolute','qualified','preferential') then raise exception 'Unsupported presidential electoral system';end if;
 if p_system_type='qualified' and (p_threshold_pct is null or p_threshold_pct<=50 or p_threshold_pct>100) then raise exception 'Qualified majority requires a threshold above 50 and at most 100';end if;
 insert into public.presidential_system_proposals(game_id,system_type,threshold_pct,rationale,proposed_by)
 values(p_game_id,p_system_type,case when p_system_type='absolute' then 50 when p_system_type='qualified' then p_threshold_pct else null end,
        nullif(trim(coalesce(p_rationale,'')),''),v_uid) returning id into v_id;return v_id;
end;$$;
revoke all on function public.propose_presidential_system(uuid,text,numeric,text) from public,anon;
grant execute on function public.propose_presidential_system(uuid,text,numeric,text) to authenticated;

create or replace function public.open_presidential_system_vote(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_system_proposals%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;v_label text;
begin
 select * into p from public.presidential_system_proposals where id=p_proposal_id for update;if p.id is null then raise exception 'Proposal not found';end if;
 if not private.can_manage_presidential_system_vote(p.game_id,v_uid) then raise exception 'Duma / faction / teacher access required';end if;
 if p.status<>'draft' then raise exception 'Proposal is not a draft';end if;
 if exists(select 1 from public.game_votes where game_id=p.game_id and stage_no=7 and status='open' and procedure_key='presidential_system') then raise exception 'Close the current presidential-system vote first';end if;
 v_label:=case p.system_type when 'relative' then 'относительного большинства' when 'absolute' then 'абсолютного большинства (50% + 1)'
   when 'qualified' then 'квалифицированного большинства ('||p.threshold_pct||'%)' else 'преференциального большинства' end;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(p.game_id,7,'ГД · система выборов Президента РФ','Предлагается мажоритарная система '||v_label||coalesce('. Обоснование: '||p.rationale,''),
  'mandate','open',v_uid,'gd','presidential_system','fraction',0.5,'present_majority',0.5,true,false,'none','none') returning id into v_vote;
 update public.presidential_system_proposals set status='vote_open',vote_id=v_vote,updated_at=now() where id=p.id;return v_vote;
end;$$;
revoke all on function public.open_presidential_system_vote(uuid) from public,anon;
grant execute on function public.open_presidential_system_vote(uuid) to authenticated;

create or replace function private.presidential_system_vote_trigger()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_system_proposals%rowtype;
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='presidential_system' then
  select * into p from public.presidential_system_proposals where vote_id=new.id;
  if p.id is not null then
   if new.result_code='passed' then
    update public.presidential_system_proposals set status='superseded',updated_at=now() where game_id=new.game_id and status='adopted' and id<>p.id;
    update public.presidential_system_proposals set status='adopted',updated_at=now() where id=p.id;
    insert into public.presidential_election_settings(game_id,system_type,threshold_pct,poll_enabled,status,updated_by)
    values(new.game_id,p.system_type,coalesce(p.threshold_pct,50),true,'setup',new.created_by)
    on conflict(game_id) do update set system_type=excluded.system_type,threshold_pct=excluded.threshold_pct,
      status=case when presidential_election_settings.status='finished' then 'setup' else presidential_election_settings.status end,
      result='{}'::jsonb,updated_at=now(),updated_by=new.created_by;
   else update public.presidential_system_proposals set status='rejected',updated_at=now() where id=p.id;end if;
  end if;
 end if;return new;
end;$$;
revoke execute on function private.presidential_system_vote_trigger() from public,anon,authenticated;
drop trigger if exists trg_presidential_system_vote on public.game_votes;
create trigger trg_presidential_system_vote after update of status on public.game_votes for each row execute function private.presidential_system_vote_trigger();

create or replace function public.create_presidential_election_appointment_resolution(p_game_id uuid,p_body text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_role text;v_doc uuid;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id) and v_role not like '%совет%федерац%' and v_role not like '%сенатор%' then raise exception 'Federation Council / teacher access required';end if;
 if exists(select 1 from public.formal_documents where game_id=p_game_id and stage_no=7 and doc_type='sf_resolution' and metadata->>'purpose'='presidential_election_appointment')
 then raise exception 'Federation Council appointment resolution already exists';end if;
 v_doc:=public.create_formal_document(p_game_id,7,'О назначении выборов Президента Российской Федерации','sf_resolution',
  'sf','Совет Федерации Федерального Собрания Российской Федерации',
  coalesce(nullif(trim(p_body),''),'Назначить внеочередные выборы Президента Российской Федерации в сроки, определённые игровой процедурой.'),
  null,null,null,'sf_resolution',jsonb_build_object('purpose','presidential_election_appointment'));
 return v_doc;
end;$$;
revoke all on function public.create_presidential_election_appointment_resolution(uuid,text) from public,anon;
grant execute on function public.create_presidential_election_appointment_resolution(uuid,text) to authenticated;

create or replace function public.configure_presidential_election(p_game_id uuid,p_system_type text,p_threshold_pct numeric,p_poll_enabled boolean)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_adopted text;v_threshold numeric;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 if p_system_type not in ('relative','absolute','qualified','preferential') then raise exception 'Unsupported election system';end if;
 select system_type,threshold_pct into v_adopted,v_threshold from public.presidential_system_proposals
 where game_id=p_game_id and status='adopted' order by updated_at desc limit 1;
 if v_adopted is not null and p_system_type<>v_adopted then raise exception 'Election system is fixed by the adopted State Duma decision: %',v_adopted;end if;
 if v_adopted='qualified' then p_threshold_pct:=coalesce(v_threshold,p_threshold_pct);end if;
 if p_threshold_pct<0 or p_threshold_pct>100 then raise exception 'Threshold must be 0-100';end if;
 insert into public.presidential_election_settings(game_id,system_type,threshold_pct,poll_enabled,updated_by)
 values(p_game_id,coalesce(v_adopted,p_system_type),p_threshold_pct,p_poll_enabled,v_uid)
 on conflict(game_id) do update set system_type=excluded.system_type,threshold_pct=excluded.threshold_pct,poll_enabled=excluded.poll_enabled,
   updated_at=now(),updated_by=v_uid,status=case when presidential_election_settings.status='finished' then 'setup' else presidential_election_settings.status end,result='{}'::jsonb;
end;$$;
revoke all on function public.configure_presidential_election(uuid,text,numeric,boolean) from public,anon;
grant execute on function public.configure_presidential_election(uuid,text,numeric,boolean) to authenticated;