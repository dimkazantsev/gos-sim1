CREATE OR REPLACE FUNCTION public.blitz_vsn(p_game uuid, p_student uuid, p_stage integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid(); total_q int; correct_q int; answered_q int; cases_n int; correct_cases numeric; acts int; c numeric; a numeric; b numeric; completion numeric;
begin
 if uid is null or (uid<>p_student and not exists(select 1 from public.game_members where game_id=p_game and user_id=uid and kind='teacher')) or not exists(select 1 from public.game_members where game_id=p_game and user_id=p_student) then raise exception 'Forbidden' using errcode='42501'; end if;
 select count(*),count(*) filter(where is_correct),count(*) filter(where chosen_index is not null)
 into total_q,correct_q,answered_q from public.blitz_assignments where game_id=p_game and user_id=p_student and stage_no=p_stage;
 select count(*)::integer,coalesce(sum(e.score_share) filter(where e.best_option and e.authority_ok and e.lawful),0)
 into cases_n,correct_cases from public.event_authority_evidence e
 where e.game_id=p_game and e.actor_id=p_student and e.stage_no=p_stage;
 select count(*) into acts from public.player_actions where game_id=p_game and author_id=p_student and round_no=p_stage and status='accepted';
 c:=case when cases_n>0 then 0.30*least(1,correct_cases::numeric/cases_n) else 0 end;
 a:=0.30*least(1,acts::numeric/3);
 b:=case when total_q>0 then 0.30*correct_q::numeric/total_q else 0 end;
 completion:=case when total_q>0 then 0.10*answered_q::numeric/total_q else 0 end;
 return jsonb_build_object('score',round(c+a+b+completion,2),'cases',round(c,2),'actions',round(a,2),'blitz',round(b,2),'completion',round(completion,2),'cases_total',cases_n,'cases_right',correct_cases,'actions_right',acts,'quiz_total',total_q,'quiz_right',correct_q,'quiz_answered',answered_q);
end $function$
;
revoke all on function public.blitz_vsn(uuid,uuid,integer) from public,anon;
grant execute on function public.blitz_vsn(uuid,uuid,integer) to authenticated;
