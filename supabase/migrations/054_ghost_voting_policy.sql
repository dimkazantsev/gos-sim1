-- Stage 5: formal Ghost Voting policy adopted by the State Duma.
create table if not exists public.ghost_voting_policies(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 policy_mode text not null check(policy_mode in ('prohibited','justified','allowed')),
 rationale text,
 status text not null default 'draft' check(status in ('draft','vote_open','adopted','rejected','superseded')),
 vote_id uuid references public.game_votes(id) on delete set null,
 proposed_by uuid not null references auth.users(id) on delete cascade,
 adopted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists ghost_voting_policies_game_idx on public.ghost_voting_policies(game_id,created_at desc);
alter table public.ghost_voting_policies enable row level security;
revoke all privileges on table public.ghost_voting_policies from anon,authenticated;
grant select on table public.ghost_voting_policies to authenticated;
drop policy if exists ghost_voting_policies_read on public.ghost_voting_policies;
create policy ghost_voting_policies_read on public.ghost_voting_policies for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ghost_voting_policies')
 then alter publication supabase_realtime add table public.ghost_voting_policies; end if;
end $$;

create or replace function public.propose_ghost_voting_policy(p_game_id uuid,p_policy_mode text,p_rationale text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_role text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_policy_mode not in ('prohibited','justified','allowed') then raise exception 'Unsupported Ghost Voting policy'; end if;
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id) and private.party_led_by(p_game_id,v_uid) is null and v_role not like '%депутат%'
 then raise exception 'Deputy / faction leader / teacher access required'; end if;
 insert into public.ghost_voting_policies(game_id,policy_mode,rationale,proposed_by)
 values(p_game_id,p_policy_mode,nullif(trim(coalesce(p_rationale,'')),''),v_uid) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.propose_ghost_voting_policy(uuid,text,text) from public,anon;
grant execute on function public.propose_ghost_voting_policy(uuid,text,text) to authenticated;

create or replace function public.open_ghost_voting_policy_vote(p_policy_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.ghost_voting_policies%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;v_label text;
begin
 select * into p from public.ghost_voting_policies where id=p_policy_id for update;
 if p.id is null then raise exception 'Ghost Voting policy proposal not found'; end if;
 if not private.is_game_teacher(p.game_id) and private.party_led_by(p.game_id,v_uid) is null then raise exception 'Faction leader / teacher access required'; end if;
 if p.status<>'draft' then raise exception 'Proposal is not a draft'; end if;
 if exists(select 1 from public.game_votes where game_id=p.game_id and stage_no=5 and status='open' and procedure_key='ghost_policy')
 then raise exception 'Close the current Ghost Voting policy vote first'; end if;
 v_label:=case p.policy_mode
  when 'prohibited' then 'Ghost voting запрещён; жеребьёвка проводится по авторскому правилу через каждые 2 заседания ГД'
  when 'justified' then 'Ghost voting разрешён по уважительной причине; авторское правило указывает проведение через одно заседание ГД'
  else 'Ghost voting разрешён; авторское правило указывает проведение всегда' end;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(p.game_id,5,'Постановление ГД · режим Ghost voting',v_label||coalesce('. Обоснование: '||p.rationale,''),
  'mandate','open',v_uid,'gd','ghost_policy','fraction',0.5,'yes_no_simple',0.5,true,false,'none','none')
 returning id into v_vote;
 update public.ghost_voting_policies set status='vote_open',vote_id=v_vote,updated_at=now() where id=p.id;
 return v_vote;
end;$$;
revoke all on function public.open_ghost_voting_policy_vote(uuid) from public,anon;
grant execute on function public.open_ghost_voting_policy_vote(uuid) to authenticated;

create or replace function private.ghost_policy_vote_trigger()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='ghost_policy' then
  if new.result_code='passed' then
   update public.ghost_voting_policies set status='superseded',updated_at=now() where game_id=new.game_id and status='adopted';
   update public.ghost_voting_policies set status='adopted',adopted_at=now(),updated_at=now() where vote_id=new.id;
  else
   update public.ghost_voting_policies set status='rejected',updated_at=now() where vote_id=new.id;
  end if;
 end if;
 return new;
end;$$;
revoke execute on function private.ghost_policy_vote_trigger() from public,anon,authenticated;
drop trigger if exists trg_ghost_policy_vote on public.game_votes;
create trigger trg_ghost_policy_vote after update of status on public.game_votes
for each row execute function private.ghost_policy_vote_trigger();
