-- Full ghost-voting draw aligned with the author's game rules.
-- The teacher sets a total absence of 25..50 deputies; the system randomly selects
-- one or more affected factions and distributes the temporary mandate loss.

create table if not exists public.ghost_voting_rounds(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null default 5,
  total_loss integer not null check(total_loss between 25 and 50),
  result jsonb not null default '[]'::jsonb,
  status text not null default 'drawn' check(status in ('drawn','cleared')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);

create index if not exists ghost_voting_rounds_game_created_idx
  on public.ghost_voting_rounds(game_id,created_at desc);

alter table public.ghost_voting_rounds enable row level security;
revoke all privileges on table public.ghost_voting_rounds from anon,authenticated;
grant select on table public.ghost_voting_rounds to authenticated;

drop policy if exists ghost_voting_rounds_read on public.ghost_voting_rounds;
create policy ghost_voting_rounds_read on public.ghost_voting_rounds
for select to authenticated
using(private.is_game_member(game_id));

create or replace function public.draw_ghost_voting(
  p_game_id uuid,
  p_total_loss integer default null
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_uid uuid:=(select auth.uid());
  v_total integer;
  v_target_count integer;
  v_remaining integer;
  v_remaining_targets integer;
  v_share integer;
  v_capacity integer;
  v_take integer;
  v_result jsonb:='[]'::jsonb;
  v_round uuid;
  r record;
begin
  if not private.is_game_teacher(p_game_id) then
    raise exception 'Teacher access required';
  end if;
  if private.has_open_duma_mandate_vote(p_game_id) then
    raise exception 'Run ghost voting before opening the State Duma mandate vote';
  end if;

  if not exists(
    select 1 from public.game_parties where game_id=p_game_id and mandates>0
  ) then raise exception 'No parliamentary parties with mandates'; end if;

  v_total:=coalesce(p_total_loss,25+floor(random()*26)::integer);
  if v_total<25 or v_total>50 then
    raise exception 'Ghost voting loss must be from 25 to 50';
  end if;

  -- A new draw replaces any previous temporary absence before the meeting.
  for r in select id from public.game_parties where game_id=p_game_id and ghost_active=true
  loop
    update public.game_parties
       set ghost_loss_current=0,ghost_active=false,ghost_started_at=null
     where id=r.id;
    perform private.rebalance_party_mandates(r.id);
  end loop;

  select least(count(*)::integer,1+floor(random()*least(3,count(*))::numeric)::integer)
    into v_target_count
  from public.game_parties
  where game_id=p_game_id and mandates>0;

  v_target_count:=greatest(1,v_target_count);
  v_remaining:=v_total;
  v_remaining_targets:=v_target_count;

  for r in
    select id,name,mandates
    from public.game_parties
    where game_id=p_game_id and mandates>0
    order by random()
    limit v_target_count
  loop
    v_capacity:=greatest(0,r.mandates);
    if v_remaining_targets<=1 then
      v_share:=least(v_remaining,v_capacity);
    else
      -- Preserve at least one deputy of loss for each remaining selected faction.
      v_share:=greatest(1,floor(random()*greatest(1,v_remaining-v_remaining_targets+1))::integer+1);
      v_share:=least(v_share,v_capacity,v_remaining-(v_remaining_targets-1));
    end if;
    v_share:=greatest(0,v_share);

    if v_share>0 then
      update public.game_parties
         set ghost_loss_current=v_share,ghost_active=true,ghost_started_at=now()
       where id=r.id;
      perform private.rebalance_party_mandates(r.id);
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'party_id',r.id,'party_name',r.name,'loss',v_share
      ));
      v_remaining:=v_remaining-v_share;
    end if;
    v_remaining_targets:=v_remaining_targets-1;
  end loop;

  -- If a selected faction lacked enough mandates, distribute any remainder
  -- among affected parliamentary factions with free capacity.
  while v_remaining>0 loop
    select p.id,p.name,p.mandates,p.ghost_loss_current
      into r
    from public.game_parties p
    where p.game_id=p_game_id
      and p.ghost_active=true
      and p.ghost_loss_current<p.mandates
    order by random()
    limit 1;

    exit when r.id is null;
    v_take:=least(v_remaining,r.mandates-r.ghost_loss_current);
    update public.game_parties
       set ghost_loss_current=ghost_loss_current+v_take
     where id=r.id;
    perform private.rebalance_party_mandates(r.id);

    select coalesce(jsonb_agg(
      case when x->>'party_id'=r.id::text
        then jsonb_set(x,'{loss}',to_jsonb((x->>'loss')::integer+v_take))
        else x end
    ),'[]'::jsonb)
    into v_result
    from jsonb_array_elements(v_result) x;
    v_remaining:=v_remaining-v_take;
  end loop;

  insert into public.ghost_voting_rounds(game_id,total_loss,result,created_by)
  values(p_game_id,v_total,v_result,v_uid)
  returning id into v_round;

  insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
  values(
    p_game_id,5,'Ghost voting','warning','Ghost voting · жеребьёвка',
    'На ближайшем заседании ГД временно отсутствуют '||v_total||
    ' депутатов. Распределение: '||
    coalesce((select string_agg((x->>'party_name')||' −'||(x->>'loss'),'; ')
              from jsonb_array_elements(v_result) x),'нет потерь'),
    v_uid
  );

  return jsonb_build_object('round_id',v_round,'total_loss',v_total,'result',v_result);
end;
$$;

revoke all on function public.draw_ghost_voting(uuid,integer) from public,anon;
grant execute on function public.draw_ghost_voting(uuid,integer) to authenticated;

create or replace function public.clear_party_ghost_loss(p_game_id uuid,p_party_id uuid default null)
returns void
language plpgsql
security definer
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
 if p_party_id is null then
   update public.ghost_voting_rounds
      set status='cleared',cleared_at=now()
    where game_id=p_game_id and status='drawn';
 end if;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,5,'Ghost voting','notice','Состав фракций восстановлен','Ghost voting завершён: на следующем заседании действуют полные мандаты партий.',v_uid);
end;
$$;

revoke all on function public.clear_party_ghost_loss(uuid,uuid) from public,anon;
grant execute on function public.clear_party_ghost_loss(uuid,uuid) to authenticated;
