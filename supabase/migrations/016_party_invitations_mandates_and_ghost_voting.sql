-- Party invitations, individual mandate blocks and ghost voting.

alter table public.game_members
  add column if not exists party_joined_at timestamptz;

alter table public.game_parties
  add column if not exists ghost_loss_current integer not null default 0,
  add column if not exists ghost_active boolean not null default false,
  add column if not exists ghost_started_at timestamptz;

alter table public.game_parties drop constraint if exists game_parties_ghost_loss_check;
alter table public.game_parties
  add constraint game_parties_ghost_loss_check check(ghost_loss_current>=0);

create table if not exists public.party_invitations(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  party_id uuid not null references public.game_parties(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index if not exists party_invites_one_pending
  on public.party_invitations(party_id,invited_user_id) where status='pending';
create index if not exists party_invites_game_idx on public.party_invitations(game_id,created_at desc);
create index if not exists party_invites_user_idx on public.party_invitations(invited_user_id,status);

alter table public.party_invitations enable row level security;
grant select on public.party_invitations to authenticated;
drop policy if exists party_invitations_read on public.party_invitations;
create policy party_invitations_read on public.party_invitations
for select to authenticated
using(
  private.is_game_teacher(game_id)
  or invited_user_id=(select auth.uid())
  or exists(
    select 1 from public.game_parties p
    where p.id=party_invitations.party_id
      and p.leader_user_id=(select auth.uid())
  )
);

create table if not exists public.party_member_mandates(
  game_id uuid not null references public.games(id) on delete cascade,
  party_id uuid not null references public.game_parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  base_mandates integer not null default 0 check(base_mandates>=0),
  ghost_loss integer not null default 0 check(ghost_loss>=0),
  effective_mandates integer not null default 0 check(effective_mandates>=0),
  updated_at timestamptz not null default now(),
  primary key(game_id,party_id,user_id)
);
create index if not exists party_member_mandates_user_idx
  on public.party_member_mandates(game_id,user_id);
alter table public.party_member_mandates enable row level security;
grant select on public.party_member_mandates to authenticated;
drop policy if exists party_member_mandates_read on public.party_member_mandates;
create policy party_member_mandates_read on public.party_member_mandates
for select to authenticated using(private.is_game_member(game_id));

create or replace function private.is_party_leader(p_party uuid,p_user uuid)
returns boolean
language sql stable security definer
set search_path=public,private,pg_temp
as $$
select exists(select 1 from public.game_parties p where p.id=p_party and p.leader_user_id=p_user);
$$;

create or replace function private.rebalance_party_mandates(p_party uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.game_parties%rowtype;
begin
 select * into p from public.game_parties where id=p_party;
 if p.id is null then return;end if;

 delete from public.party_member_mandates a
 where a.party_id=p.id
   and not exists(
    select 1 from public.game_members gm
    where gm.game_id=p.game_id and gm.user_id=a.user_id
      and gm.kind='student' and gm.team=p.name
   );

 with ranked as (
  select gm.user_id,
    row_number() over(order by coalesce(gm.party_joined_at,gm.joined_at),gm.user_id) as rn,
    count(*) over() as n
  from public.game_members gm
  where gm.game_id=p.game_id and gm.kind='student' and gm.team=p.name
 ),
 calc as (
  select r.user_id,
    floor(greatest(0,p.mandates)::numeric/r.n)::int
      + case when r.rn <= (greatest(0,p.mandates)%r.n) then 1 else 0 end as base_mandates,
    floor(least(greatest(0,p.ghost_loss_current),greatest(0,p.mandates))::numeric/r.n)::int
      + case when r.rn <= (least(greatest(0,p.ghost_loss_current),greatest(0,p.mandates))%r.n) then 1 else 0 end as ghost_loss
  from ranked r
 )
 insert into public.party_member_mandates(game_id,party_id,user_id,base_mandates,ghost_loss,effective_mandates,updated_at)
 select p.game_id,p.id,c.user_id,c.base_mandates,c.ghost_loss,greatest(0,c.base_mandates-c.ghost_loss),now()
 from calc c
 on conflict(game_id,party_id,user_id)
 do update set
   base_mandates=excluded.base_mandates,
   ghost_loss=excluded.ghost_loss,
   effective_mandates=excluded.effective_mandates,
   updated_at=now();

 update public.game_ballots b
 set weight=a.effective_mandates
 from public.party_member_mandates a,public.game_votes v
 where b.vote_id=v.id and v.status='open' and v.voting_mode='mandate'
   and v.game_id=p.game_id and a.party_id=p.id and a.game_id=p.game_id
   and a.user_id=b.voter_id;
end;
$$;

create or replace function private.rebalance_party_trigger()
returns trigger language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin perform private.rebalance_party_mandates(new.id);return new;end;
$$;
drop trigger if exists trg_rebalance_party on public.game_parties;
create trigger trg_rebalance_party
after insert or update of mandates,ghost_loss_current,ghost_active on public.game_parties
for each row execute function private.rebalance_party_trigger();

create or replace function private.rebalance_member_party_trigger()
returns trigger language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_old uuid;v_new uuid;
begin
 if tg_op in ('UPDATE','DELETE') and old.team is not null then
  select id into v_old from public.game_parties where game_id=old.game_id and name=old.team limit 1;
 end if;
 if tg_op in ('INSERT','UPDATE') and new.team is not null then
  select id into v_new from public.game_parties where game_id=new.game_id and name=new.team limit 1;
 end if;
 if v_old is not null then perform private.rebalance_party_mandates(v_old);end if;
 if v_new is not null and v_new is distinct from v_old then perform private.rebalance_party_mandates(v_new);end if;
 return case when tg_op='DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_rebalance_member_party on public.game_members;
create trigger trg_rebalance_member_party
after insert or update of team,party_joined_at or delete on public.game_members
for each row execute function private.rebalance_member_party_trigger();

update public.game_members
set party_joined_at=coalesce(party_joined_at,joined_at)
where team is not null and kind='student';

do $$
declare r record;
begin
 for r in select id from public.game_parties loop
  perform private.rebalance_party_mandates(r.id);
 end loop;
end $$;

create or replace function public.set_party_leader(p_party_id uuid,p_user_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.game_parties%rowtype;gm public.game_members%rowtype;ch uuid;old_party uuid;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if p.id is null then raise exception 'Party not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 select * into gm from public.game_members where game_id=p.game_id and user_id=p_user_id for update;
 if gm.user_id is null or gm.kind<>'student' then raise exception 'Student not found';end if;

 if gm.team is not null and gm.team<>p.name then
  select id into old_party from public.game_parties where game_id=p.game_id and name=gm.team limit 1;
  delete from public.channel_members cm using public.chat_channels cc
  where cm.channel_id=cc.id and cm.user_id=p_user_id and cc.game_id=p.game_id and cc.kind='team';
 end if;

 update public.game_parties set leader_user_id=null
 where game_id=p.game_id and leader_user_id=p_user_id and id<>p.id;
 update public.game_parties set leader_user_id=p_user_id where id=p.id;
 update public.game_members
 set team=p.name,party_joined_at=case when gm.team=p.name then coalesce(party_joined_at,now()) else now() end
 where game_id=p.game_id and user_id=p_user_id;

 update public.party_invitations set status='cancelled',responded_at=now()
 where game_id=p.game_id and invited_user_id=p_user_id and status='pending';

 select id into ch from public.chat_channels
 where game_id=p.game_id and kind='team' and name='Фракция · '||p.name limit 1;
 if ch is not null then
  insert into public.channel_members(channel_id,user_id) values(ch,p_user_id) on conflict do nothing;
 end if;

 if old_party is not null then perform private.rebalance_party_mandates(old_party);end if;
 perform private.rebalance_party_mandates(p.id);
end;
$$;
revoke all on function public.set_party_leader(uuid,uuid) from public,anon;
grant execute on function public.set_party_leader(uuid,uuid) to authenticated;

create or replace function public.invite_to_party(p_party_id uuid,p_user_id uuid)
returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.game_parties%rowtype;gm public.game_members%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into p from public.game_parties where id=p_party_id;
 if p.id is null then raise exception 'Party not found';end if;
 if not (private.is_game_teacher(p.game_id) or private.is_party_leader(p.id,v_uid)) then raise exception 'Only party leader or teacher may invite';end if;
 select * into gm from public.game_members where game_id=p.game_id and user_id=p_user_id;
 if gm.user_id is null or gm.kind<>'student' then raise exception 'Student not found';end if;
 if gm.team is not null then raise exception 'Student already belongs to a party';end if;
 insert into public.party_invitations(game_id,party_id,invited_user_id,invited_by)
 values(p.game_id,p.id,p_user_id,v_uid)
 on conflict do nothing returning id into v_id;
 if v_id is null then
  select id into v_id from public.party_invitations
  where party_id=p.id and invited_user_id=p_user_id and status='pending'
  order by created_at desc limit 1;
 end if;
 return v_id;
end;
$$;
revoke all on function public.invite_to_party(uuid,uuid) from public,anon;
grant execute on function public.invite_to_party(uuid,uuid) to authenticated;

create or replace function public.respond_party_invitation(p_invitation_id uuid,p_accept boolean)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare inv public.party_invitations%rowtype;p public.game_parties%rowtype;gm public.game_members%rowtype;v_uid uuid:=(select auth.uid());ch uuid;
begin
 select * into inv from public.party_invitations where id=p_invitation_id for update;
 if inv.id is null or inv.status<>'pending' then raise exception 'Invitation is not active';end if;
 if inv.invited_user_id<>v_uid then raise exception 'Invitation belongs to another user';end if;
 select * into p from public.game_parties where id=inv.party_id;
 select * into gm from public.game_members where game_id=inv.game_id and user_id=v_uid for update;
 if gm.user_id is null then raise exception 'Game member not found';end if;

 if p_accept then
  if gm.team is not null and gm.team<>p.name then raise exception 'You already belong to another party';end if;
  update public.game_members set team=p.name,party_joined_at=coalesce(party_joined_at,now())
   where game_id=inv.game_id and user_id=v_uid;
  update public.party_invitations set status='accepted',responded_at=now() where id=inv.id;
  update public.party_invitations set status='cancelled',responded_at=now()
   where game_id=inv.game_id and invited_user_id=v_uid and id<>inv.id and status='pending';
  select id into ch from public.chat_channels
   where game_id=inv.game_id and kind='team' and name='Фракция · '||p.name limit 1;
  if ch is not null then insert into public.channel_members(channel_id,user_id) values(ch,v_uid) on conflict do nothing;end if;
 else
  update public.party_invitations set status='declined',responded_at=now() where id=inv.id;
 end if;
 perform private.rebalance_party_mandates(p.id);
end;
$$;
revoke all on function public.respond_party_invitation(uuid,boolean) from public,anon;
grant execute on function public.respond_party_invitation(uuid,boolean) to authenticated;

create or replace function public.cancel_party_invitation(p_invitation_id uuid)
returns void language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare inv public.party_invitations%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into inv from public.party_invitations where id=p_invitation_id for update;
 if inv.id is null or inv.status<>'pending' then return;end if;
 if not (private.is_game_teacher(inv.game_id) or inv.invited_by=v_uid or private.is_party_leader(inv.party_id,v_uid)) then raise exception 'Not allowed';end if;
 update public.party_invitations set status='cancelled',responded_at=now() where id=inv.id;
end;
$$;
revoke all on function public.cancel_party_invitation(uuid) from public,anon;
grant execute on function public.cancel_party_invitation(uuid) to authenticated;

create or replace function public.remove_party_member(p_party_id uuid,p_user_id uuid)
returns void language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.game_parties%rowtype;ch uuid;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if p.id is null then raise exception 'Party not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 if p.leader_user_id=p_user_id then update public.game_parties set leader_user_id=null where id=p.id;end if;
 update public.game_members set team=null,party_joined_at=null
 where game_id=p.game_id and user_id=p_user_id and team=p.name;
 select id into ch from public.chat_channels where game_id=p.game_id and kind='team' and name='Фракция · '||p.name limit 1;
 if ch is not null then delete from public.channel_members where channel_id=ch and user_id=p_user_id;end if;
 perform private.rebalance_party_mandates(p.id);
end;
$$;
revoke all on function public.remove_party_member(uuid,uuid) from public,anon;
grant execute on function public.remove_party_member(uuid,uuid) to authenticated;

create or replace function public.apply_party_ghost_loss(p_party_id uuid,p_loss integer)
returns void language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.game_parties%rowtype;v_uid uuid:=(select auth.uid());v_loss integer;v_desc text;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if p.id is null then raise exception 'Party not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 if p_loss<25 or p_loss>50 then raise exception 'Ghost voting loss must be from 25 to 50';end if;
 v_loss:=least(p_loss,greatest(0,p.mandates));
 update public.game_parties set ghost_loss_current=v_loss,ghost_active=(v_loss>0),ghost_started_at=now() where id=p.id;
 v_desc:='Ghost voting: фракция «'||p.name||'» теряет '||v_loss||' депутатов на ближайшем заседании ГД. Потеря распределена между студентами фракции.';
 insert into public.game_crises(game_id,stage_no,crisis_type,intensity,description,effects,created_by)
 values(p.game_id,5,'Ghost voting','medium',v_desc,jsonb_build_object('party_id',p.id,'loss',v_loss),v_uid);
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p.game_id,5,'Ghost voting','warning','Ghost voting · '||p.name,v_desc,v_uid);
 perform private.rebalance_party_mandates(p.id);
end;
$$;
revoke all on function public.apply_party_ghost_loss(uuid,integer) from public,anon;
grant execute on function public.apply_party_ghost_loss(uuid,integer) to authenticated;

create or replace function public.clear_party_ghost_loss(p_game_id uuid,p_party_id uuid default null)
returns void language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare r record;v_uid uuid:=(select auth.uid());
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 for r in select id,name from public.game_parties where game_id=p_game_id and ghost_active=true and (p_party_id is null or id=p_party_id)
 loop
  update public.game_parties set ghost_loss_current=0,ghost_active=false,ghost_started_at=null where id=r.id;
  perform private.rebalance_party_mandates(r.id);
 end loop;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,5,'Ghost voting','notice','Состав фракций восстановлен','Ghost voting завершён: на следующем заседании действуют полные мандаты партий.',v_uid);
end;
$$;
revoke all on function public.clear_party_ghost_loss(uuid,uuid) from public,anon;
grant execute on function public.clear_party_ghost_loss(uuid,uuid) to authenticated;

create or replace function private.vote_eligible_weight(p_vote public.game_votes,p_user uuid)
returns numeric language plpgsql stable security definer
set search_path=public,private,pg_temp
as $$
declare p public.game_parties%rowtype;v_weight numeric;
begin
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

create or replace function private.vote_total_eligible_weight(p_vote public.game_votes)
returns numeric language plpgsql stable security definer
set search_path=public,private,pg_temp
as $$
declare v numeric;
begin
 if p_vote.voting_mode='faction' then
  select count(*)::numeric into v from public.game_parties where game_id=p_vote.game_id and leader_user_id is not null;
 elsif p_vote.voting_mode='mandate' then
  select coalesce(sum(greatest(0,mandates)),0)::numeric into v from public.game_parties where game_id=p_vote.game_id;
 else
  select count(*)::numeric into v from public.game_members gm
   where gm.game_id=p_vote.game_id and private.vote_member_matches(p_vote.game_id,gm.user_id,p_vote.institution_key);
 end if;
 return coalesce(v,0);
end;
$$;

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='party_invitations') then
  alter publication supabase_realtime add table public.party_invitations;
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='party_member_mandates') then
  alter publication supabase_realtime add table public.party_member_mandates;
 end if;
end $$;
