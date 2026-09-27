-- Enforce 450-seat chamber and freeze representation while a State Duma mandate vote is open.

create or replace function private.has_open_duma_mandate_vote(p_game uuid)
returns boolean
language sql stable security definer
set search_path=public,private,pg_temp
as $$
select exists(
 select 1 from public.game_votes
 where game_id=p_game and status='open'
   and voting_mode='mandate' and institution_key='gd'
);
$$;

create or replace function public.set_party_mandates(p_party_id uuid,p_mandates integer)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.game_parties%rowtype;v_other integer;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if p.id is null then raise exception 'Party not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 if private.has_open_duma_mandate_vote(p.game_id) then raise exception 'Close the current State Duma mandate vote before changing mandates';end if;
 if p_mandates<0 or p_mandates>450 then raise exception 'Mandates must be from 0 to 450';end if;
 select coalesce(sum(mandates),0)::int into v_other from public.game_parties where game_id=p.game_id and id<>p.id;
 if v_other+p_mandates>450 then raise exception 'The State Duma has only 450 mandates. Remaining: %',greatest(0,450-v_other);end if;
 update public.game_parties set mandates=p_mandates where id=p.id;
end;
$$;
revoke all on function public.set_party_mandates(uuid,integer) from public,anon;
grant execute on function public.set_party_mandates(uuid,integer) to authenticated;

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
 if private.has_open_duma_mandate_vote(p.game_id) then raise exception 'Party leadership is frozen while a State Duma mandate vote is open';end if;
 select * into gm from public.game_members where game_id=p.game_id and user_id=p_user_id for update;
 if gm.user_id is null or gm.kind<>'student' then raise exception 'Student not found';end if;
 if gm.team is not null and gm.team<>p.name then
  select id into old_party from public.game_parties where game_id=p.game_id and name=gm.team limit 1;
  delete from public.channel_members cm using public.chat_channels cc
  where cm.channel_id=cc.id and cm.user_id=p_user_id and cc.game_id=p.game_id and cc.kind='team';
 end if;
 update public.game_parties set leader_user_id=null where game_id=p.game_id and leader_user_id=p_user_id and id<>p.id;
 update public.game_parties set leader_user_id=p_user_id where id=p.id;
 update public.game_members set team=p.name,party_joined_at=case when gm.team=p.name then coalesce(party_joined_at,now()) else now() end
 where game_id=p.game_id and user_id=p_user_id;
 update public.party_invitations set status='cancelled',responded_at=now()
 where game_id=p.game_id and invited_user_id=p_user_id and status='pending';
 select id into ch from public.chat_channels where game_id=p.game_id and kind='team' and name='Фракция · '||p.name limit 1;
 if ch is not null then insert into public.channel_members(channel_id,user_id) values(ch,p_user_id) on conflict do nothing;end if;
 if old_party is not null then perform private.rebalance_party_mandates(old_party);end if;
 perform private.rebalance_party_mandates(p.id);
end;
$$;

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
  if private.has_open_duma_mandate_vote(inv.game_id) then raise exception 'Party membership is frozen while a State Duma mandate vote is open';end if;
  if gm.team is not null and gm.team<>p.name then raise exception 'You already belong to another party';end if;
  update public.game_members set team=p.name,party_joined_at=coalesce(party_joined_at,now()) where game_id=inv.game_id and user_id=v_uid;
  update public.party_invitations set status='accepted',responded_at=now() where id=inv.id;
  update public.party_invitations set status='cancelled',responded_at=now()
   where game_id=inv.game_id and invited_user_id=v_uid and id<>inv.id and status='pending';
  select id into ch from public.chat_channels where game_id=inv.game_id and kind='team' and name='Фракция · '||p.name limit 1;
  if ch is not null then insert into public.channel_members(channel_id,user_id) values(ch,v_uid) on conflict do nothing;end if;
 else
  update public.party_invitations set status='declined',responded_at=now() where id=inv.id;
 end if;
 perform private.rebalance_party_mandates(p.id);
end;
$$;

create or replace function public.remove_party_member(p_party_id uuid,p_user_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.game_parties%rowtype;ch uuid;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if p.id is null then raise exception 'Party not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 if private.has_open_duma_mandate_vote(p.game_id) then raise exception 'Party membership is frozen while a State Duma mandate vote is open';end if;
 if p.leader_user_id=p_user_id then update public.game_parties set leader_user_id=null where id=p.id;end if;
 update public.game_members set team=null,party_joined_at=null where game_id=p.game_id and user_id=p_user_id and team=p.name;
 select id into ch from public.chat_channels where game_id=p.game_id and kind='team' and name='Фракция · '||p.name limit 1;
 if ch is not null then delete from public.channel_members where channel_id=ch and user_id=p_user_id;end if;
 perform private.rebalance_party_mandates(p.id);
end;
$$;

create or replace function public.apply_party_ghost_loss(p_party_id uuid,p_loss integer)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.game_parties%rowtype;v_uid uuid:=(select auth.uid());v_loss integer;v_desc text;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if p.id is null then raise exception 'Party not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 if private.has_open_duma_mandate_vote(p.game_id) then raise exception 'Apply ghost voting before opening the State Duma vote';end if;
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

create or replace function public.clear_party_ghost_loss(p_game_id uuid,p_party_id uuid default null)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare r record;v_uid uuid:=(select auth.uid());
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 if private.has_open_duma_mandate_vote(p_game_id) then raise exception 'Close all open State Duma mandate votes before ending ghost voting';end if;
 for r in select id,name from public.game_parties where game_id=p_game_id and ghost_active=true and (p_party_id is null or id=p_party_id)
 loop
  update public.game_parties set ghost_loss_current=0,ghost_active=false,ghost_started_at=null where id=r.id;
  perform private.rebalance_party_mandates(r.id);
 end loop;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,5,'Ghost voting','notice','Состав фракций восстановлен','Ghost voting завершён: на следующем заседании действуют полные мандаты партий.',v_uid);
end;
$$;
