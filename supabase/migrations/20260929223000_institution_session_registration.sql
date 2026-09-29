-- Session check-in is explicit and separate from permanent institutional appointments.
-- Existing votes remain unchanged. "registered_session" votes enforce check-in.
create table if not exists public.institution_session_registrations (
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null check(stage_no between 1 and 16),
 institution_key text not null check(institution_key in ('gd','government','municipality')),
 user_id uuid not null,
 registered_at timestamptz not null default now(),
 primary key(game_id,stage_no,institution_key,user_id),
 foreign key(game_id,user_id) references public.game_members(game_id,user_id) on delete cascade
);
alter table public.institution_session_registrations enable row level security;
drop policy if exists institution_registration_read on public.institution_session_registrations;
create policy institution_registration_read on public.institution_session_registrations for select to authenticated
 using(private.is_game_member(game_id));
revoke all on public.institution_session_registrations from public,anon;
grant select on public.institution_session_registrations to authenticated;

create or replace function public.register_institution_session(p_game_id uuid,p_institution text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_user uuid:=(select auth.uid());v_stage integer;
begin
 if p_institution not in ('gd','government','municipality') then raise exception 'Unsupported institution';end if;
 if not private.is_game_member(p_game_id) or v_user is null then raise exception 'Game access required';end if;
 if not private.vote_member_matches(p_game_id,v_user,p_institution) then raise exception 'The assigned game role does not permit registration in this institution';end if;
 select current_round into v_stage from public.games where id=p_game_id;
 if v_stage is null then raise exception 'Game unavailable';end if;
 insert into public.institution_session_registrations(game_id,stage_no,institution_key,user_id)
 values(p_game_id,v_stage,p_institution,v_user)
 on conflict do nothing;
 insert into public.game_activity(game_id,actor_id,event_type,label,view_key,payload)
 values(p_game_id,v_user,'institution_checkin','Регистрация на заседание: '||p_institution,'votes',
 jsonb_build_object('institution',p_institution,'stage_no',v_stage));
end;
$$;
revoke all on function public.register_institution_session(uuid,text) from public,anon;
grant execute on function public.register_institution_session(uuid,text) to authenticated;

-- Only the explicit registered_session procedure requires a session attendance check.
-- Mandate-weighted votes still get their weight from rebalance_party_mandates and
-- Ghost Voting reductions, while ordinary existing votes keep legacy eligibility.
create or replace function private.vote_eligible_weight(p_vote public.game_votes,p_user uuid)
returns numeric language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare p public.game_parties%rowtype; v_weight numeric;
begin
 if p_vote.procedure_key='registered_session' and p_vote.institution_key in ('gd','government','municipality')
 and not exists(select 1 from public.institution_session_registrations r
  where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no
  and r.institution_key=p_vote.institution_key and r.user_id=p_user)
 then return 0;end if;
 if p_vote.voting_mode='faction' then
   select * into p from public.game_parties gp where gp.game_id=p_vote.game_id and gp.leader_user_id=p_user limit 1;
   return case when p.id is null then 0 else 1 end;
 elsif p_vote.voting_mode='mandate' then
   select coalesce(a.effective_mandates,0) into v_weight
   from public.party_member_mandates a where a.game_id=p_vote.game_id and a.user_id=p_user limit 1;
   return coalesce(v_weight,0);
 end if;
 if private.vote_member_matches(p_vote.game_id,p_user,p_vote.institution_key) then return 1;end if;
 return 0;
end;
$$;
