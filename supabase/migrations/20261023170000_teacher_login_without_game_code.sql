-- Permanent teacher sign-in: list owned/managed games after personal password login.
-- No game code or invite code is required. Never modifies membership or grants rights.
create or replace function public.list_my_teacher_games()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $body$
declare
  v_user uuid := (select auth.uid());
  v_admin boolean;
  v_allowed boolean;
  v_games jsonb;
begin
  if v_user is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
  then
    raise exception 'Войдите с подтверждённой почтой и личным паролем';
  end if;

  v_admin := private.is_platform_admin();
  v_allowed := v_admin
    or exists (select 1 from public.games g where g.owner_id=v_user)
    or exists (
      select 1 from public.game_members gm
      where gm.user_id=v_user and gm.kind='teacher'
        and gm.roster_archived_at is null
    );
  if not v_allowed then
    raise exception 'Кабинет доступен только преподавателю или администратору';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('id',g.id,'title',g.title,
      'status',g.status,'created_at',g.created_at)
    order by g.created_at desc,g.id desc
  ),'[]'::jsonb)
  into v_games
  from public.games g
  where v_admin or g.owner_id=v_user or exists (
    select 1 from public.game_members gm
    where gm.game_id=g.id and gm.user_id=v_user
      and gm.kind='teacher' and gm.roster_archived_at is null
  );
  return jsonb_build_object('is_admin',v_admin,'games',v_games);
end;
$body$;

revoke all on function public.list_my_teacher_games() from public,anon,authenticated;
grant execute on function public.list_my_teacher_games() to authenticated;
comment on function public.list_my_teacher_games() is
  'Read-only teacher dashboard after password authentication, without any game code.';
