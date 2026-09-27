-- Stage 15: auditable crisis consequences for public-office roles.
create table if not exists public.game_role_consequences(
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 crisis_id uuid references public.game_crises(id) on delete set null,
 status text not null default 'active' check(status in ('active','suspended','arrested','detained','deceased','incapacitated')),
 reason text,until_at timestamptz,set_by uuid not null references auth.users(id) on delete cascade,set_at timestamptz not null default now(),
 cleared_by uuid references auth.users(id) on delete set null,cleared_at timestamptz,primary key(game_id,user_id)
);
create index if not exists game_role_consequences_crisis_idx on public.game_role_consequences(crisis_id,status);
alter table public.game_role_consequences enable row level security;
revoke all privileges on table public.game_role_consequences from anon,authenticated;
grant select on table public.game_role_consequences to authenticated;
drop policy if exists game_role_consequences_read on public.game_role_consequences;
create policy game_role_consequences_read on public.game_role_consequences for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_role_consequences')
 then alter publication supabase_realtime add table public.game_role_consequences; end if;
end $$;

create or replace function private.role_is_available(p_game uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select not exists(
  select 1 from public.game_role_consequences c
  where c.game_id=p_game and c.user_id=p_user and c.status<>'active' and (c.until_at is null or c.until_at>now())
 );
$$;
revoke execute on function private.role_is_available(uuid,uuid) from public,anon,authenticated;

create or replace function private.game_role(p_game uuid,p_user uuid)
returns text language sql stable security definer set search_path=public,private,pg_temp as $$
 select case when private.role_is_available(p_game,p_user) then lower(coalesce(role_title,'')) else '' end
 from public.game_members where game_id=p_game and user_id=p_user limit 1;
$$;
revoke execute on function private.game_role(uuid,uuid) from public,anon,authenticated;

create or replace function private.vote_member_matches(p_game uuid,p_user uuid,p_institution text)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
select exists(
 select 1 from public.game_members gm
 where gm.game_id=p_game and gm.user_id=p_user and gm.kind<>'observer'
   and (p_institution in ('all','factions') or private.role_is_available(p_game,p_user))
   and case
    when p_institution in ('all','factions') then gm.kind='student'
    when p_institution='gd' then coalesce(gm.role_title,'') ilike '%депутат%' or coalesce(gm.role_title,'') ilike '%государственн%дум%'
    when p_institution='government' then coalesce(gm.role_title,'') ilike '%правительств%' or coalesce(gm.role_title,'') ilike '%министр%'
    when p_institution='sf' then coalesce(gm.role_title,'') ilike '%совет%федерац%' or coalesce(gm.role_title,'') ilike '%сенатор%'
    when p_institution='committee' then coalesce(gm.role_title,'') ilike '%комитет%' or coalesce(gm.role_title,'') ilike '%депутат%'
    when p_institution='municipality' then coalesce(gm.role_title,'') ilike '%муницип%' or coalesce(gm.role_title,'') ilike '%администрац%' or coalesce(gm.role_title,'') ilike '%глава города%'
    else false end
);
$$;
revoke execute on function private.vote_member_matches(uuid,uuid,text) from public,anon,authenticated;

create or replace function private.can_create_formal_subject(p_game uuid,p_user uuid,p_subject text)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
select case
 when private.is_game_teacher(p_game) then true
 when not private.role_is_available(p_game,p_user) then false
 when p_subject='president' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%президент%')
 when p_subject='gd_deputy' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%депутат%')
 when p_subject='gd' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%председател%дум%' or coalesce(gm.role_title,'') ilike '%совет%дум%'))
 when p_subject='sf' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%председател%совет%федерац%' or coalesce(gm.role_title,'') ilike '%совет%федерац%'))
 when p_subject='sf_member' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%сенатор%')
 when p_subject='government' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%правительств%' or coalesce(gm.role_title,'') ilike '%министр%'))
 when p_subject='region' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%регион%' or coalesce(gm.role_title,'') ilike '%субъект%' or coalesce(gm.role_title,'') ilike '%законодательн%'))
 when p_subject='ks' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%конституционн%суд%')
 when p_subject='vs' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%верховн%суд%')
 when p_subject='ministry' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%министр%' or coalesce(gm.role_title,'') ilike '%министерств%'))
 when p_subject='municipality' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%муницип%' or coalesce(gm.role_title,'') ilike '%глава города%' or coalesce(gm.role_title,'') ilike '%администрац%'))
 else false end;
$$;
revoke execute on function private.can_create_formal_subject(uuid,uuid,text) from public,anon,authenticated;

create or replace function private.is_appointed_pm(p_game uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.is_game_teacher(p_game)
 or (private.role_is_available(p_game,p_user) and (
   exists(select 1 from public.government_nominations where game_id=p_game and office_kind='prime_minister' and candidate_user_id=p_user and status='appointed')
   or private.game_role(p_game,p_user) like '%председател%правительств%'
 ));
$$;
revoke execute on function private.is_appointed_pm(uuid,uuid) from public,anon,authenticated;

create or replace function public.set_crisis_role_consequence(
 p_crisis_id uuid,p_user_id uuid,p_status text,p_reason text default null,p_until_at timestamptz default null
) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.game_crises%rowtype;v_uid uuid:=(select auth.uid());v_name text;v_role text;
begin
 select * into c from public.game_crises where id=p_crisis_id;
 if c.id is null then raise exception 'Crisis not found'; end if;
 if not private.is_game_teacher(c.game_id) then raise exception 'Teacher access required'; end if;
 if p_status not in ('active','suspended','arrested','detained','deceased','incapacitated') then raise exception 'Unsupported role consequence'; end if;
 select full_name,role_title into v_name,v_role from public.game_members where game_id=c.game_id and user_id=p_user_id and kind='student';
 if v_name is null then raise exception 'Student not found in this game'; end if;
 insert into public.game_role_consequences(game_id,user_id,crisis_id,status,reason,until_at,set_by,set_at,cleared_by,cleared_at)
 values(c.game_id,p_user_id,c.id,p_status,nullif(trim(coalesce(p_reason,'')),''),p_until_at,v_uid,now(),
        case when p_status='active' then v_uid else null end,case when p_status='active' then now() else null end)
 on conflict(game_id,user_id) do update set crisis_id=c.id,status=excluded.status,reason=excluded.reason,until_at=excluded.until_at,
  set_by=v_uid,set_at=now(),cleared_by=case when p_status='active' then v_uid else null end,cleared_at=case when p_status='active' then now() else null end;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(c.game_id,c.stage_no,'Кризис',case when p_status in ('deceased','detained','arrested') then 'warning' else 'notice' end,
   'Изменение статуса роли · '||v_name,
   coalesce(v_role,'Государственная роль')||' → '||
   case p_status when 'active' then 'полномочия восстановлены' when 'suspended' then 'временно отстранён(а)'
    when 'arrested' then 'арестован(а)' when 'detained' then 'заключён(а) / задержан(а)'
    when 'deceased' then 'роль погибла' else 'роль временно недееспособна' end||
   coalesce(E'\nПричина: '||nullif(trim(coalesce(p_reason,'')),''),''),
   v_uid);
end;$$;
revoke all on function public.set_crisis_role_consequence(uuid,uuid,text,text,timestamptz) from public,anon;
grant execute on function public.set_crisis_role_consequence(uuid,uuid,text,text,timestamptz) to authenticated;