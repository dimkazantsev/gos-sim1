create or replace function public.blitz_teacher_questions(p_game uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare payload jsonb;
begin
 if auth.uid() is null or not exists (
 select 1 from public.game_members m where m.game_id=p_game and m.user_id=auth.uid() and m.kind='teacher'
 ) then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) into payload
 from (select id,topic,question,options,correct_index,legal_act,article,source_url,explanation
 from public.blitz_questions where verified=true order by id limit 2000) q;
 return payload;
end $$;
revoke all on function public.blitz_teacher_questions(uuid) from public,anon;
grant execute on function public.blitz_teacher_questions(uuid) to authenticated;