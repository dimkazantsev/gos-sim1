-- Stage 16: structured reflection on the institutional phases of the game.
create table if not exists public.game_reflections(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 phase_key text not null check(phase_key in ('foundation','parliament','executive','policy','territory','debrief')),
 decision_memory text not null default '',
 causal_analysis text not null default '',
 effectiveness text not null default '',
 improvement text not null default '',
 status text not null default 'draft' check(status in ('draft','submitted','reviewed')),
 teacher_feedback text,
 reviewed_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now(),
 submitted_at timestamptz,
 reviewed_at timestamptz,
 unique(game_id,user_id,phase_key)
);
create index if not exists game_reflections_game_idx on public.game_reflections(game_id,status,user_id);
alter table public.game_reflections enable row level security;
revoke all privileges on table public.game_reflections from anon,authenticated;
grant select on table public.game_reflections to authenticated;
drop policy if exists game_reflections_read on public.game_reflections;
create policy game_reflections_read on public.game_reflections for select to authenticated
using(user_id=(select auth.uid()) or private.is_game_teacher(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_reflections')
 then alter publication supabase_realtime add table public.game_reflections; end if;
end $$;

create or replace function public.save_game_reflection(
 p_game_id uuid,p_phase_key text,p_decision_memory text,p_causal_analysis text,p_effectiveness text,p_improvement text,p_submit boolean default false
) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_status text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_phase_key not in ('foundation','parliament','executive','policy','territory','debrief') then raise exception 'Unsupported reflection phase'; end if;
 if p_submit and (
  length(trim(coalesce(p_decision_memory,'')))<20
  or length(trim(coalesce(p_causal_analysis,'')))<20
  or length(trim(coalesce(p_effectiveness,'')))<10
  or length(trim(coalesce(p_improvement,'')))<10
 ) then raise exception 'Complete every reflection field before submission'; end if;
 v_status:=case when p_submit then 'submitted' else 'draft' end;
 insert into public.game_reflections(game_id,user_id,phase_key,decision_memory,causal_analysis,effectiveness,improvement,status,updated_at,submitted_at)
 values(p_game_id,v_uid,p_phase_key,trim(p_decision_memory),trim(p_causal_analysis),trim(p_effectiveness),trim(p_improvement),v_status,now(),case when p_submit then now() else null end)
 on conflict(game_id,user_id,phase_key) do update
 set decision_memory=excluded.decision_memory,causal_analysis=excluded.causal_analysis,effectiveness=excluded.effectiveness,
     improvement=excluded.improvement,status=excluded.status,updated_at=now(),
     submitted_at=case when p_submit then now() else game_reflections.submitted_at end,
     teacher_feedback=case when p_submit then null else game_reflections.teacher_feedback end,
     reviewed_by=case when p_submit then null else game_reflections.reviewed_by end,
     reviewed_at=case when p_submit then null else game_reflections.reviewed_at end
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.save_game_reflection(uuid,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.save_game_reflection(uuid,text,text,text,text,text,boolean) to authenticated;

create or replace function public.review_game_reflection(p_reflection_id uuid,p_feedback text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r public.game_reflections%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into r from public.game_reflections where id=p_reflection_id for update;
 if r.id is null then raise exception 'Reflection not found'; end if;
 if not private.is_game_teacher(r.game_id) then raise exception 'Teacher access required'; end if;
 if r.status='draft' then raise exception 'Student has not submitted this reflection'; end if;
 update public.game_reflections set status='reviewed',teacher_feedback=nullif(trim(coalesce(p_feedback,'')),''),
 reviewed_by=v_uid,reviewed_at=now(),updated_at=now() where id=r.id;
end;$$;
revoke all on function public.review_game_reflection(uuid,text) from public,anon;
grant execute on function public.review_game_reflection(uuid,text) to authenticated;
