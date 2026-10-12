create or replace function public.blitz_teacher_stats(p_game uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare payload jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.game_members m where m.game_id=p_game and m.user_id=auth.uid() and m.kind='teacher') then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into payload from (
  select m.user_id,
   count(a.id) filter(where a.is_correct=true) as correct,
   count(a.id) filter(where a.answered_at is not null and a.is_correct=false) as incorrect,
   count(a.id) filter(where a.answered_at is null) as pending
  from public.game_members m left join public.blitz_assignments a on a.game_id=m.game_id and a.user_id=m.user_id
  where m.game_id=p_game and m.kind='student'
  group by m.user_id
 ) t;
 return payload;
end $$;
revoke all on function public.blitz_teacher_stats(uuid) from public,anon;
grant execute on function public.blitz_teacher_stats(uuid) to authenticated;