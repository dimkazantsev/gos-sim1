-- Teacher-configurable deadlines, transparent penalty policy and atomic Ghost Voting batches.
create table if not exists public.stage_deadline_rules (
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null check(stage_no between 1 and 16),
 deadline_at timestamptz,
 inclusive boolean not null default true,
 penalty_points numeric(4,2) not null default 0 check(penalty_points between 0 and 3),
 penalty_description text not null default 'За несданный отчёт по этапу к установленному сроку',
 updated_by uuid,
 updated_at timestamptz not null default now(),
 primary key(game_id,stage_no)
);
alter table public.stage_deadline_rules enable row level security;
drop policy if exists stage_deadline_rules_read on public.stage_deadline_rules;
create policy stage_deadline_rules_read on public.stage_deadline_rules
 for select to authenticated using(private.is_game_member(game_id));
revoke all on public.stage_deadline_rules from public,anon;
grant select on public.stage_deadline_rules to authenticated;

create or replace function public.configure_stage_deadline(
 p_game_id uuid,p_stage_no integer,p_deadline timestamptz,p_inclusive boolean,
 p_penalty_points numeric,p_penalty_description text default null
) returns void language plpgsql security definer
set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 if p_stage_no not between 1 and 16 then raise exception 'Unknown stage';end if;
 if p_penalty_points is null or p_penalty_points<0 or p_penalty_points>3
 then raise exception 'Penalty must be between 0 and 3';end if;
 if not exists(select 1 from public.game_stages where game_id=p_game_id and stage_no=p_stage_no)
 then raise exception 'Stage not found';end if;
 insert into public.stage_deadline_rules(game_id,stage_no,deadline_at,inclusive,penalty_points,penalty_description,updated_by,updated_at)
 values(p_game_id,p_stage_no,p_deadline,p_inclusive,p_penalty_points,
 coalesce(nullif(trim(p_penalty_description),''),'За несданный отчёт по этапу к установленному сроку'),auth.uid(),now())
 on conflict(game_id,stage_no) do update set deadline_at=excluded.deadline_at,inclusive=excluded.inclusive,
 penalty_points=excluded.penalty_points,penalty_description=excluded.penalty_description,updated_by=excluded.updated_by,updated_at=now();
 update public.game_stages set deadline=p_deadline where game_id=p_game_id and stage_no=p_stage_no;
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,auth.uid(),'stage_deadline_configured','game_stages',
 jsonb_build_object('stage_no',p_stage_no,'deadline',p_deadline,'inclusive',p_inclusive,
 'penalty_points',p_penalty_points,'description',p_penalty_description));
end;
$$;
revoke all on function public.configure_stage_deadline(uuid,integer,timestamptz,boolean,numeric,text) from public,anon;
grant execute on function public.configure_stage_deadline(uuid,integer,timestamptz,boolean,numeric,text) to authenticated;

create or replace function public.apply_ghost_voting_batch(
 p_game_id uuid,p_losses jsonb
) returns jsonb language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare item jsonb; target public.game_parties%rowtype; total integer:=0; applied jsonb:='[]'::jsonb; loss integer;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 if jsonb_typeof(p_losses)<>'array' or jsonb_array_length(p_losses)<1 or jsonb_array_length(p_losses)>100
 then raise exception 'Supply an array of party losses';end if;
 if private.has_open_duma_mandate_vote(p_game_id)
 then raise exception 'Close State Duma mandate votes before Ghost Voting';end if;
 if (select count(distinct item->>'party_id') from jsonb_array_elements(p_losses) item)
 <>jsonb_array_length(p_losses) then raise exception 'Duplicate party in batch';end if;
 for item in select value from jsonb_array_elements(p_losses) loop
  select * into target from public.game_parties where id=(item->>'party_id')::uuid and game_id=p_game_id for update;
  if not found then raise exception 'Party not found';end if;
  if (item->>'loss') is null or (item->>'loss') !~ '^[0-9]{1,3}$' then raise exception 'Invalid loss';end if;
  loss:=(item->>'loss')::integer;
  if loss<0 or loss>least(50,target.mandates) then raise exception 'Ghost loss must be 0..min(50, mandates)';end if;
  update public.game_parties set ghost_loss_current=loss,ghost_active=loss>0,
    ghost_started_at=case when loss>0 then now() else null end where id=target.id;
  perform private.rebalance_party_mandates(target.id);
  applied:=applied||jsonb_build_array(jsonb_build_object('party_id',target.id,'name',target.name,'loss',loss));
  total:=total+loss;
 end loop;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,5,'Ghost voting','warning','Назначенные потери мандатов',
 'Преподаватель назначил Ghost Voting: всего потеряно '||total||' мандатов. '||applied::text,auth.uid());
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,auth.uid(),'ghost_voting_batch','game_parties',jsonb_build_object('losses',applied));
 return jsonb_build_object('total_loss',total,'result',applied);
end;
$$;
revoke all on function public.apply_ghost_voting_batch(uuid,jsonb) from public,anon;
grant execute on function public.apply_ghost_voting_batch(uuid,jsonb) to authenticated;
