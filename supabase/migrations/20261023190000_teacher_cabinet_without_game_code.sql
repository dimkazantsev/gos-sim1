-- ГОС.ID: отдельный кабинет преподавателя и администратора без кода игры.
-- Все проверки полномочий выполняются на сервере; пароли приглашений не возвращаются.
create or replace function public.get_my_teacher_games()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_teacher boolean;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'Войдите по электронной почте и личному паролю' using errcode='42501';
  end if;
  v_admin := private.is_platform_admin();
  select exists(
    select 1 from public.game_members gm
    where gm.user_id=v_uid and gm.kind='teacher' and gm.roster_archived_at is null
  ) into v_teacher;
  if not v_admin and not v_teacher then
    raise exception 'Доступ разрешён только преподавателю или администратору' using errcode='42501';
  end if;
  return jsonb_build_object(
    'allowed', true,
    'admin', v_admin,
    'games', coalesce((
      select jsonb_agg(to_jsonb(visible_games) order by visible_games.created_at desc)
      from (
        select g.id,g.title,g.game_code,g.status,g.created_at
        from public.games g
        where v_admin or exists(
          select 1 from public.game_members gm
          where gm.game_id=g.id and gm.user_id=v_uid
            and gm.kind='teacher' and gm.roster_archived_at is null
        )
        order by g.created_at desc limit 60
      ) visible_games
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_teacher_games() from public, anon;
grant execute on function public.get_my_teacher_games() to authenticated;

create or replace function public.create_teacher_game_session(
  p_title text, p_game_code text, p_teacher_code text, p_student_code text, p_teacher_name text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise exception 'Войдите по электронной почте и личному паролю' using errcode='42501';
  end if;
  if not private.is_platform_admin() and not exists (
    select 1 from public.game_members gm
    where gm.user_id=auth.uid() and gm.kind='teacher' and gm.roster_archived_at is null
  ) then
    raise exception 'Создавать игры может только преподаватель или администратор' using errcode='42501';
  end if;
  return public.create_game_session(p_title,p_game_code,p_teacher_code,p_student_code,p_teacher_name);
end;
$$;
revoke all on function public.create_teacher_game_session(text,text,text,text,text) from public, anon;
grant execute on function public.create_teacher_game_session(text,text,text,text,text) to authenticated;
