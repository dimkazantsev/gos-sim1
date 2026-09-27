-- Deadline consequence ledger. Magnitudes are deliberately teacher-supplied where
-- the author's rules define the consequence type but not a fixed numeric amount.

alter table public.game_parties
  add column if not exists representation_penalty integer not null default 0 check(representation_penalty>=0),
  add column if not exists regional_seat_penalty integer not null default 0 check(regional_seat_penalty>=0),
  add column if not exists ghost_risk_weight numeric not null default 1 check(ghost_risk_weight>=0.1),
  add column if not exists presidential_rating_modifier numeric not null default 0;

create table if not exists public.stage_deadline_incidents(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null check(stage_no between 1 and 16),
  party_id uuid references public.game_parties(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  consequence_type text not null check(consequence_type in (
    'representation_loss','regional_seat_loss','ghost_risk','presidential_rating_loss','other'
  )),
  magnitude numeric,
  note text not null,
  status text not null default 'active' check(status in ('active','reverted')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  reverted_at timestamptz,
  reverted_by uuid references auth.users(id) on delete set null,
  check(party_id is not null or user_id is not null)
);

create index if not exists stage_deadline_incidents_game_idx
  on public.stage_deadline_incidents(game_id,stage_no,created_at desc);
create index if not exists stage_deadline_incidents_party_idx
  on public.stage_deadline_incidents(party_id,status,created_at desc);

alter table public.stage_deadline_incidents enable row level security;
revoke all privileges on table public.stage_deadline_incidents from anon,authenticated;
grant select on table public.stage_deadline_incidents to authenticated;
drop policy if exists stage_deadline_incidents_read on public.stage_deadline_incidents;
create policy stage_deadline_incidents_read on public.stage_deadline_incidents
for select to authenticated using(private.is_game_member(game_id));

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stage_deadline_incidents')
 then alter publication supabase_realtime add table public.stage_deadline_incidents; end if;
end $$;

create or replace function public.record_deadline_consequence(
 p_game_id uuid,p_stage_no integer,p_party_id uuid,p_user_id uuid,
 p_consequence_type text,p_magnitude numeric,p_note text
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_mag numeric:=coalesce(p_magnitude,0);
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage must be 1-16'; end if;
 if p_party_id is null and p_user_id is null then raise exception 'Party or user target is required'; end if;
 if p_party_id is not null and not exists(select 1 from public.game_parties where id=p_party_id and game_id=p_game_id)
   then raise exception 'Party target not found'; end if;
 if p_user_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_user_id)
   then raise exception 'User target not found'; end if;
 if p_consequence_type not in ('representation_loss','regional_seat_loss','ghost_risk','presidential_rating_loss','other')
   then raise exception 'Unsupported consequence type'; end if;
 if length(trim(coalesce(p_note,'')))<5 then raise exception 'Explain why the consequence is applied'; end if;
 if p_consequence_type<>'other' and v_mag<=0 then raise exception 'Positive magnitude is required'; end if;
 if p_party_id is null and p_consequence_type<>'other' then raise exception 'This consequence type requires a party target'; end if;

 insert into public.stage_deadline_incidents(game_id,stage_no,party_id,user_id,consequence_type,magnitude,note,created_by)
 values(p_game_id,p_stage_no,p_party_id,p_user_id,p_consequence_type,p_magnitude,trim(p_note),v_uid)
 returning id into v_id;

 if p_party_id is not null then
  update public.game_parties
  set representation_penalty=representation_penalty+
        case when p_consequence_type='representation_loss' then ceil(v_mag)::integer else 0 end,
      regional_seat_penalty=regional_seat_penalty+
        case when p_consequence_type='regional_seat_loss' then ceil(v_mag)::integer else 0 end,
      ghost_risk_weight=greatest(0.1,ghost_risk_weight+
        case when p_consequence_type='ghost_risk' then v_mag else 0 end),
      presidential_rating_modifier=presidential_rating_modifier-
        case when p_consequence_type='presidential_rating_loss' then v_mag else 0 end
  where id=p_party_id;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,p_stage_no,'Дедлайн','warning','Зафиксировано последствие за нарушение срока',
   trim(p_note),v_uid);

 return v_id;
end;
$$;
revoke all on function public.record_deadline_consequence(uuid,integer,uuid,uuid,text,numeric,text) from public,anon;
grant execute on function public.record_deadline_consequence(uuid,integer,uuid,uuid,text,numeric,text) to authenticated;

create or replace function public.revert_deadline_consequence(p_incident_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare i public.stage_deadline_incidents%rowtype;v_uid uuid:=(select auth.uid());v_mag numeric;
begin
 select * into i from public.stage_deadline_incidents where id=p_incident_id for update;
 if i.id is null then raise exception 'Deadline incident not found'; end if;
 if not private.is_game_teacher(i.game_id) then raise exception 'Teacher access required'; end if;
 if i.status='reverted' then return; end if;
 v_mag:=coalesce(i.magnitude,0);

 if i.party_id is not null then
  update public.game_parties
  set representation_penalty=greatest(0,representation_penalty-
        case when i.consequence_type='representation_loss' then ceil(v_mag)::integer else 0 end),
      regional_seat_penalty=greatest(0,regional_seat_penalty-
        case when i.consequence_type='regional_seat_loss' then ceil(v_mag)::integer else 0 end),
      ghost_risk_weight=greatest(0.1,ghost_risk_weight-
        case when i.consequence_type='ghost_risk' then v_mag else 0 end),
      presidential_rating_modifier=presidential_rating_modifier+
        case when i.consequence_type='presidential_rating_loss' then v_mag else 0 end
  where id=i.party_id;
 end if;

 update public.stage_deadline_incidents set status='reverted',reverted_at=now(),reverted_by=v_uid where id=i.id;
end;
$$;
revoke all on function public.revert_deadline_consequence(uuid) from public,anon;
grant execute on function public.revert_deadline_consequence(uuid) to authenticated;

-- Weight the random ghost-voting target draw by accumulated deadline risk.
create or replace function public.draw_ghost_voting(p_game_id uuid,p_total_loss integer default null)
returns jsonb
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_uid uuid:=(select auth.uid());v_total integer;v_target_count integer;v_remaining integer;
  v_remaining_targets integer;v_share integer;v_capacity integer;v_take integer;
  v_result jsonb:='[]'::jsonb;v_round uuid;r record;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 if private.has_open_duma_mandate_vote(p_game_id) then raise exception 'Run ghost voting before opening the State Duma mandate vote'; end if;
 if not exists(select 1 from public.game_parties where game_id=p_game_id and mandates>0) then raise exception 'No parliamentary parties with mandates'; end if;
 v_total:=coalesce(p_total_loss,25+floor(random()*26)::integer);
 if v_total<25 or v_total>50 then raise exception 'Ghost voting loss must be from 25 to 50'; end if;

 for r in select id from public.game_parties where game_id=p_game_id and ghost_active=true loop
  update public.game_parties set ghost_loss_current=0,ghost_active=false,ghost_started_at=null where id=r.id;
  perform private.rebalance_party_mandates(r.id);
 end loop;

 select least(count(*)::integer,1+floor(random()*least(3,count(*))::numeric)::integer) into v_target_count
 from public.game_parties where game_id=p_game_id and mandates>0;
 v_target_count:=greatest(1,v_target_count);v_remaining:=v_total;v_remaining_targets:=v_target_count;

 for r in
  select id,name,mandates,ghost_risk_weight
  from public.game_parties
  where game_id=p_game_id and mandates>0
  order by (-ln(greatest(random(),0.000000001))/greatest(ghost_risk_weight,0.1))
  limit v_target_count
 loop
  v_capacity:=greatest(0,r.mandates);
  if v_remaining_targets<=1 then v_share:=least(v_remaining,v_capacity);
  else
   v_share:=greatest(1,floor(random()*greatest(1,v_remaining-v_remaining_targets+1))::integer+1);
   v_share:=least(v_share,v_capacity,v_remaining-(v_remaining_targets-1));
  end if;
  v_share:=greatest(0,v_share);
  if v_share>0 then
   update public.game_parties set ghost_loss_current=v_share,ghost_active=true,ghost_started_at=now() where id=r.id;
   perform private.rebalance_party_mandates(r.id);
   v_result:=v_result||jsonb_build_array(jsonb_build_object('party_id',r.id,'party_name',r.name,'loss',v_share,'risk_weight',r.ghost_risk_weight));
   v_remaining:=v_remaining-v_share;
  end if;
  v_remaining_targets:=v_remaining_targets-1;
 end loop;

 while v_remaining>0 loop
  select p.id,p.name,p.mandates,p.ghost_loss_current,p.ghost_risk_weight into r
  from public.game_parties p
  where p.game_id=p_game_id and p.ghost_active=true and p.ghost_loss_current<p.mandates
  order by random() limit 1;
  exit when r.id is null;
  v_take:=least(v_remaining,r.mandates-r.ghost_loss_current);
  update public.game_parties set ghost_loss_current=ghost_loss_current+v_take where id=r.id;
  perform private.rebalance_party_mandates(r.id);
  select coalesce(jsonb_agg(case when x->>'party_id'=r.id::text
    then jsonb_set(x,'{loss}',to_jsonb((x->>'loss')::integer+v_take)) else x end),'[]'::jsonb)
  into v_result from jsonb_array_elements(v_result) x;
  v_remaining:=v_remaining-v_take;
 end loop;

 insert into public.ghost_voting_rounds(game_id,total_loss,result,created_by)
 values(p_game_id,v_total,v_result,v_uid) returning id into v_round;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,5,'Ghost voting','warning','Ghost voting · жеребьёвка',
  'На ближайшем заседании ГД временно отсутствуют '||v_total||' депутатов. Распределение: '||
  coalesce((select string_agg((x->>'party_name')||' −'||(x->>'loss'),'; ') from jsonb_array_elements(v_result) x),'нет потерь'),v_uid);
 return jsonb_build_object('round_id',v_round,'total_loss',v_total,'result',v_result);
end;
$$;
revoke all on function public.draw_ghost_voting(uuid,integer) from public,anon;
grant execute on function public.draw_ghost_voting(uuid,integer) to authenticated;
