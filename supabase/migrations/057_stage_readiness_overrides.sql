-- Explicit teacher acknowledgement for stages completed before structured mechanics existed.
create table if not exists public.stage_readiness_overrides(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null check(stage_no between 1 and 16),
 reason text not null,
 is_active boolean not null default true,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 revoked_by uuid references auth.users(id) on delete set null,
 revoked_at timestamptz,
 unique(game_id,stage_no)
);
create index if not exists stage_readiness_overrides_game_idx on public.stage_readiness_overrides(game_id,stage_no,is_active);
alter table public.stage_readiness_overrides enable row level security;
revoke all privileges on table public.stage_readiness_overrides from anon,authenticated;
grant select on table public.stage_readiness_overrides to authenticated;
drop policy if exists stage_readiness_overrides_read on public.stage_readiness_overrides;
create policy stage_readiness_overrides_read on public.stage_readiness_overrides
for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stage_readiness_overrides')
 then alter publication supabase_realtime add table public.stage_readiness_overrides; end if;
end $$;

create or replace function public.set_stage_readiness_override(p_game_id uuid,p_stage_no integer,p_reason text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());
begin
 if v_uid is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage number must be 1-16'; end if;
 if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Add a short reason explaining the historical/manual completion'; end if;
 insert into public.stage_readiness_overrides(game_id,stage_no,reason,is_active,created_by,created_at,revoked_by,revoked_at)
 values(p_game_id,p_stage_no,trim(p_reason),true,v_uid,now(),null,null)
 on conflict(game_id,stage_no) do update
 set reason=excluded.reason,is_active=true,created_by=v_uid,created_at=now(),revoked_by=null,revoked_at=null;
end;$$;
revoke all on function public.set_stage_readiness_override(uuid,integer,text) from public,anon;
grant execute on function public.set_stage_readiness_override(uuid,integer,text) to authenticated;

create or replace function public.clear_stage_readiness_override(p_game_id uuid,p_stage_no integer)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());
begin
 if v_uid is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 update public.stage_readiness_overrides set is_active=false,revoked_by=v_uid,revoked_at=now()
 where game_id=p_game_id and stage_no=p_stage_no;
end;$$;
revoke all on function public.clear_stage_readiness_override(uuid,integer) from public,anon;
grant execute on function public.clear_stage_readiness_override(uuid,integer) to authenticated;

create or replace function public.get_stage_readiness(p_game_id uuid,p_stage_no integer)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v jsonb;v_reason text;v_at timestamptz;v_original jsonb;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage number must be 1-16'; end if;
 v:=private.stage_readiness_json(p_game_id,p_stage_no);
 select reason,created_at into v_reason,v_at from public.stage_readiness_overrides
 where game_id=p_game_id and stage_no=p_stage_no and is_active order by created_at desc limit 1;
 if v_reason is not null then
  v_original:=coalesce(v->'blockers','[]'::jsonb);
  v:=jsonb_set(jsonb_set(v,'{ready}','true'::jsonb),'{blockers}','[]'::jsonb)
    ||jsonb_build_object(
      'overridden',true,'override_reason',v_reason,'override_at',v_at,'original_blockers',v_original,
      'warnings',(v->'warnings')||jsonb_build_array('Историческое прохождение подтверждено преподавателем; структурированные данные этого этапа могут отсутствовать')
    );
 else v:=v||jsonb_build_object('overridden',false,'original_blockers','[]'::jsonb); end if;
 return v;
end;$$;
revoke all on function public.get_stage_readiness(uuid,integer) from public,anon;
grant execute on function public.get_stage_readiness(uuid,integer) to authenticated;

create or replace function public.get_game_readiness(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v jsonb:='[]'::jsonb;i integer;v_stage jsonb;v_reason text;v_at timestamptz;v_original jsonb;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 for i in 1..16 loop
  v_stage:=private.stage_readiness_json(p_game_id,i);
  v_reason:=null;v_at:=null;
  select reason,created_at into v_reason,v_at from public.stage_readiness_overrides
   where game_id=p_game_id and stage_no=i and is_active order by created_at desc limit 1;
  if v_reason is not null then
   v_original:=coalesce(v_stage->'blockers','[]'::jsonb);
   v_stage:=jsonb_set(jsonb_set(v_stage,'{ready}','true'::jsonb),'{blockers}','[]'::jsonb)
     ||jsonb_build_object(
       'overridden',true,'override_reason',v_reason,'override_at',v_at,'original_blockers',v_original,
       'warnings',(v_stage->'warnings')||jsonb_build_array('Историческое прохождение подтверждено преподавателем; структурированные данные этого этапа могут отсутствовать')
     );
  else v_stage:=v_stage||jsonb_build_object('overridden',false,'original_blockers','[]'::jsonb); end if;
  v:=v||jsonb_build_array(v_stage);
 end loop;
 return v;
end;$$;
revoke all on function public.get_game_readiness(uuid) from public,anon;
grant execute on function public.get_game_readiness(uuid) to authenticated;
