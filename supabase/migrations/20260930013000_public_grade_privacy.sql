-- Game participants can see each other's numeric VSН grades, but not private
-- evidence_summary, personal rationale, assessment runs or teacher notes.
drop policy if exists stage_assessments_read on public.stage_assessments;
create policy stage_assessments_read on public.stage_assessments for select to authenticated
 using(private.is_game_teacher(game_id) or
  (user_id=(select auth.uid()) and private.is_game_member(game_id)));

create or replace function public.get_public_stage_scores(p_game_id uuid)
returns table(user_id uuid,stage_no integer,auto_score integer,final_score integer,status text)
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 return query select a.user_id,a.stage_no,a.auto_score,a.final_score,a.status
 from public.stage_assessments a where a.game_id=p_game_id
 order by a.user_id,a.stage_no;
end;
$$;
revoke all on function public.get_public_stage_scores(uuid) from public,anon;
grant execute on function public.get_public_stage_scores(uuid) to authenticated;
