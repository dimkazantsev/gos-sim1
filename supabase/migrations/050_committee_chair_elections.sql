-- Stage 9 committee-chair elections reuse the multi-candidate Duma office-election engine.
alter table public.office_elections drop constraint if exists office_elections_office_key_check;
alter table public.office_elections add constraint office_elections_office_key_check
check(office_key in ('gd_chair','gd_deputy_1','gd_deputy_2') or office_key like 'committee:%');

create or replace function public.create_committee_chair_election(p_unit_id uuid,p_vote_mode text default 'open')
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_key text;
begin
 select * into u from public.institution_units where id=p_unit_id;
 if u.id is null or u.unit_kind<>'committee' then raise exception 'Committee not found'; end if;
 if not private.is_game_teacher(u.game_id) and private.game_role(u.game_id,v_uid) not like '%председател%дум%' and private.game_role(u.game_id,v_uid) not like '%совет%дум%' then raise exception 'State Duma chair / Council / teacher access required'; end if;
 if p_vote_mode not in ('open','secret') then raise exception 'Unsupported vote mode'; end if;
 v_key:='committee:'||u.id::text;
 if exists(select 1 from public.office_elections where game_id=u.game_id and office_key=v_key and status in ('nomination','open')) then raise exception 'An active chair election already exists for this committee'; end if;
 insert into public.office_elections(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,created_by)
 values(u.game_id,9,v_key,'Председатель · '||u.title,1,p_vote_mode,'nomination',v_uid) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.create_committee_chair_election(uuid,text) from public,anon;
grant execute on function public.create_committee_chair_election(uuid,text) to authenticated;

create or replace function private.committee_chair_election_trigger() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_unit uuid;v_user uuid;
begin
 if new.status='finished' and new.winner_candidate_id is not null and new.office_key like 'committee:%'
    and (old.status is distinct from new.status or old.winner_candidate_id is distinct from new.winner_candidate_id)
 then
  v_unit:=substring(new.office_key from 11)::uuid;
  select user_id into v_user from public.office_candidates where id=new.winner_candidate_id;
  update public.institution_units set head_user_id=v_user where id=v_unit and game_id=new.game_id and unit_kind='committee';
  if v_user is not null then
   insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
   values(new.game_id,v_unit,'committee',v_user,private.member_party_id(new.game_id,v_user),'head',new.created_by)
   on conflict(game_id,user_id,unit_kind) do update set unit_id=excluded.unit_id,party_id=excluded.party_id,assignment_role='head',created_by=excluded.created_by,created_at=now();
  end if;
 end if;
 return new;
end;$$;
revoke execute on function private.committee_chair_election_trigger() from public,anon,authenticated;
drop trigger if exists trg_committee_chair_election on public.office_elections;
create trigger trg_committee_chair_election after update of status,winner_candidate_id on public.office_elections
for each row execute function private.committee_chair_election_trigger();