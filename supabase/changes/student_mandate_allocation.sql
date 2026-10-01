alter table public.game_parties add column if not exists mandate_allocation_mode text not null default 'equal' check(mandate_allocation_mode in ('equal','custom'));
create or replace function private.rebalance_party_mandates(p_party uuid) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.game_parties%rowtype;custom_ok boolean;loss integer;
begin
 select * into p from public.game_parties where id=p_party for update;
 if p.id is null then return;end if;
 delete from public.party_member_mandates a where a.party_id=p.id and not exists(select 1 from public.game_members m where m.game_id=p.game_id and m.user_id=a.user_id and m.kind='student' and m.team=p.name);
 custom_ok:=p.mandate_allocation_mode='custom'
 and (select coalesce(sum(base_mandates),0) from public.party_member_mandates where party_id=p.id)=p.mandates
 and not exists(select 1 from public.game_members m where m.game_id=p.game_id and m.kind='student' and m.team=p.name and not exists(select 1 from public.party_member_mandates a where a.party_id=p.id and a.user_id=m.user_id));
 if not custom_ok then
  update public.game_parties set mandate_allocation_mode='equal' where id=p.id and mandate_allocation_mode<>'equal';
  with ranked as (select user_id,row_number() over(order by coalesce(party_joined_at,joined_at),user_id) rn,count(*) over() n from public.game_members where game_id=p.game_id and kind='student' and team=p.name)
  insert into public.party_member_mandates(game_id,party_id,user_id,base_mandates,ghost_loss,effective_mandates,updated_at)
  select p.game_id,p.id,user_id,floor(p.mandates::numeric/n)::int+case when rn<=p.mandates%n then 1 else 0 end,0,0,now() from ranked
  on conflict(game_id,party_id,user_id) do update set base_mandates=excluded.base_mandates,updated_at=now();
 end if;
 loss:=least(greatest(0,p.ghost_loss_current),greatest(0,p.mandates));
 with shares as (select user_id,base_mandates,case when p.mandates>0 then loss*base_mandates::numeric/p.mandates else 0 end raw from public.party_member_mandates where party_id=p.id),
 ranked as (select *,row_number() over(order by raw-floor(raw) desc,user_id) rn,loss-sum(floor(raw)) over() remainder from shares),
 calculated as (select user_id,floor(raw)::int+case when rn<=remainder then 1 else 0 end deduction from ranked)
 update public.party_member_mandates a set ghost_loss=c.deduction,effective_mandates=a.base_mandates-c.deduction,updated_at=now() from calculated c where a.party_id=p.id and a.user_id=c.user_id;
 -- Already-open votes retain the electorate and weights captured at their opening.
end;$$;
create or replace function public.set_student_mandates(p_party_id uuid,p_allocations jsonb default null) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.game_parties%rowtype;total numeric;entry record;
begin
 select * into p from public.game_parties where id=p_party_id;
 if p.id is null or auth.uid() is null or not private.is_game_teacher(p.game_id) then raise exception 'Требуются права преподавателя';end if;
 perform 1 from public.games where id=p.game_id for update;
 select * into p from public.game_parties where id=p_party_id for update;
 if private.has_open_duma_mandate_vote(p.game_id) then raise exception 'Сначала завершите открытое голосование Государственной Думы';end if;
 if p_allocations is null then update public.game_parties set mandate_allocation_mode='equal' where id=p.id;perform private.rebalance_party_mandates(p.id);return;end if;
 if jsonb_typeof(p_allocations)<>'object' then raise exception 'Неверный формат распределения';end if;
 total:=0;
 for entry in select key,value from jsonb_each_text(p_allocations) loop
  if entry.value !~ '^\d+$' or entry.value::numeric>450 then raise exception 'Число мандатов должно быть целым от 0 до 450';end if;
  if not exists(select 1 from public.game_members where game_id=p.game_id and user_id::text=entry.key and kind='student' and team=p.name) then raise exception 'Участник не входит в эту фракцию';end if;
  total:=total+entry.value::numeric;
 end loop;
 if total<>p.mandates then raise exception 'Распределите ровно % мандатов; сейчас распределено %',p.mandates,total;end if;
 if exists(select 1 from public.game_members m where m.game_id=p.game_id and m.kind='student' and m.team=p.name and not p_allocations ? m.user_id::text) then raise exception 'Укажите число мандатов для каждого участника';end if;
 insert into public.party_member_mandates(game_id,party_id,user_id,base_mandates,ghost_loss,effective_mandates)
 select p.game_id,p.id,key::uuid,value::int,0,value::int from jsonb_each_text(p_allocations)
 on conflict(game_id,party_id,user_id) do update set base_mandates=excluded.base_mandates;
 update public.game_parties set mandate_allocation_mode='custom' where id=p.id;
 perform private.rebalance_party_mandates(p.id);
end;$$;
revoke all on function public.set_student_mandates(uuid,jsonb) from public,anon;
grant execute on function public.set_student_mandates(uuid,jsonb) to authenticated;
revoke all on function private.rebalance_party_mandates(uuid) from public,anon,authenticated;
