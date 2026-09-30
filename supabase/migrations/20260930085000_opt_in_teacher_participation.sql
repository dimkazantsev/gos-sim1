-- A neutral teacher stays outside the electorate. Choosing a game office is opt-in.
create or replace function private.vote_member_matches(p_game uuid,p_user uuid,p_institution text)
returns boolean language sql stable security definer set search_path='public','private','pg_temp' as $$
select exists(
 select 1 from public.game_members gm
 where gm.game_id=p_game and gm.user_id=p_user and gm.kind<>'observer'
 and (p_institution in ('all','factions') or private.role_is_available(p_game,p_user))
 and case
  when p_institution in ('all','factions') then gm.kind='student' or
   (gm.kind='teacher' and lower(trim(coalesce(gm.role_title,''))) not in ('','руководитель симуляции','преподаватель','администратор'))
  when p_institution='gd' then coalesce(gm.role_title,'') ilike '%депутат%' or coalesce(gm.role_title,'') ilike '%государственн%дум%'
  when p_institution='government' then coalesce(gm.role_title,'') ilike '%правительств%' or coalesce(gm.role_title,'') ilike '%министр%'
  when p_institution='sf' then coalesce(gm.role_title,'') ilike '%совет%федерац%' or coalesce(gm.role_title,'') ilike '%сенатор%'
  when p_institution='committee' then coalesce(gm.role_title,'') ilike '%комитет%' or coalesce(gm.role_title,'') ilike '%депутат%'
  when p_institution='municipality' then coalesce(gm.role_title,'') ilike '%муницип%' or coalesce(gm.role_title,'') ilike '%администрац%' or coalesce(gm.role_title,'') ilike '%глава города%'
  else false end
);
$$;
