-- Teacher invitation appears in teacher-only inventory; the secret remains a hash.
-- Teacher invite must never become revocable through participant/guest controls.
create or replace function public.teacher_access_code_list(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_codes jsonb;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,
  'scope',case when i.kind='teacher' then 'teacher'
               when i.kind='observer' then 'guest'
               when g.invite_id is not null then 'group'
               else 'participant' end,
  'group_name',g.group_name,
  'active',i.active,
  'created_at',i.created_at
 ) order by i.created_at desc),'[]'::jsonb) into v_codes
 from public.invite_codes i
 left join private.game_group_access_codes g on g.invite_id=i.id and g.game_id=i.game_id
 where i.game_id=p_game_id and i.kind in ('student','observer','teacher');
 return v_codes;
end $$;
revoke all on function public.teacher_access_code_list(uuid) from public,anon,authenticated;
grant execute on function public.teacher_access_code_list(uuid) to authenticated;
