-- ГОС.ID: teacher-only Blitz control panel; changes future assignments only.
-- Existing assignments, attempts, answers and VSN scores are preserved.
create table if not exists public.blitz_game_settings (
 game_id uuid primary key references public.games(id) on delete cascade,
 daily_count smallint not null default 2 check (daily_count between 1 and 5),
 enabled boolean not null default true,
 updated_by uuid,
 updated_at timestamptz not null default now()
);
alter table public.blitz_game_settings enable row level security;
revoke all on public.blitz_game_settings from public,anon,authenticated;

-- Existing 3–5-question plans remain valid. New plans may use the owner's two-question default.
alter table public.blitz_daily_plans drop constraint if exists blitz_daily_plans_target_count_check;
alter table public.blitz_daily_plans add constraint blitz_daily_plans_target_count_check
 check (target_count between 1 and 5);

create or replace function public.blitz_teacher_get_settings(p_game uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare s record;
begin
 if auth.uid() is null or not exists (
  select 1 from public.game_members m
  where m.game_id=p_game and m.user_id=auth.uid() and m.kind='teacher'
   and m.roster_archived_at is null
 ) then raise exception 'Forbidden' using errcode='42501'; end if;
 select daily_count,enabled,updated_at into s
 from public.blitz_game_settings where game_id=p_game;
 return jsonb_build_object(
  'daily_count',coalesce(s.daily_count,2),
  'enabled',coalesce(s.enabled,true),
  'updated_at',s.updated_at
 );
end $fn$;

create or replace function public.blitz_teacher_set_settings(
 p_game uuid,p_daily_count integer,p_enabled boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
begin
 if auth.uid() is null or not exists (
  select 1 from public.game_members m
  where m.game_id=p_game and m.user_id=auth.uid() and m.kind='teacher'
   and m.roster_archived_at is null
 ) then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_daily_count is null or p_daily_count not between 1 and 5 or p_enabled is null
 then raise exception 'Invalid Blitz settings' using errcode='22023'; end if;
 insert into public.blitz_game_settings(game_id,daily_count,enabled,updated_by,updated_at)
 values(p_game,p_daily_count,p_enabled,auth.uid(),clock_timestamp())
 on conflict(game_id) do update set
  daily_count=excluded.daily_count,enabled=excluded.enabled,
  updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 return public.blitz_teacher_get_settings(p_game);
end $fn$;

revoke all on function public.blitz_teacher_get_settings(uuid) from public,anon;
revoke all on function public.blitz_teacher_set_settings(uuid,integer,boolean) from public,anon;
grant execute on function public.blitz_teacher_get_settings(uuid) to authenticated;
grant execute on function public.blitz_teacher_set_settings(uuid,integer,boolean) to authenticated;

-- Keep the existing server-side issue algorithm, locking, topic diversity and no-repeat rule.
-- Replace only the randomized daily quantity with game-scoped teacher settings.
do $patch$
declare definition text; needle text:='n:=3+floor(random()*3)::integer;';
begin
 select pg_get_functiondef('public.blitz_issue_for_day(uuid,uuid,date,integer)'::regprocedure)
 into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  or position('declare n integer; ids bigint[]; inserted_count integer;' in definition)=0
 then raise exception 'Unexpected blitz_issue_for_day definition: migration aborted'; end if;
 definition:=replace(definition,
  'declare n integer; ids bigint[]; inserted_count integer;',
  'declare n integer; ids bigint[]; inserted_count integer; issue_enabled boolean;');
 definition:=replace(definition,needle,
  'select coalesce(s.daily_count,2),coalesce(s.enabled,true) into n,issue_enabled
   from (select 1) seed left join public.blitz_game_settings s on s.game_id=p_game;
   if not issue_enabled then return 0; end if;');
 execute definition;
end $patch$;
