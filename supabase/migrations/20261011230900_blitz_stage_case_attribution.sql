CREATE OR REPLACE FUNCTION public.blitz_vsn(p_game uuid, p_student uuid, p_stage integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid(); total_q int; correct_q int; answered_q int; cases_n int; correct_cases int; acts int; c numeric; a numeric; b numeric; completion numeric;
begin
 if uid is null or (uid<>p_student and not exists(select 1 from public.game_members where game_id=p_game and user_id=uid and kind='teacher')) or not exists(select 1 from public.game_members where game_id=p_game and user_id=p_student) then raise exception 'Forbidden' using errcode='42501'; end if;
 select count(*),count(*) filter(where is_correct),count(*) filter(where chosen_index is not null)
 into total_q,correct_q,answered_q from public.blitz_assignments where game_id=p_game and user_id=p_student and stage_no=p_stage;
 select count(*),count(*) filter(where coalesce((o.option->>'lawful')::boolean,false) and coalesce((o.option->>'protects_role_interest')::boolean,false) and o.option->>'public_interest'='beneficial')
 into cases_n,correct_cases from public.event_decisions d
 join public.event_cases ec on ec.id=d.case_id
 left join lateral (select x as option from jsonb_array_elements(coalesce(ec.effect_plan->'options','[]'::jsonb)) x where x->>'key'=d.choice limit 1) o on true
 where d.game_id=p_game and d.actor_id=p_student
 and exists(select 1 from public.game_stages s where s.game_id=p_game and s.stage_no=p_stage and s.opened_at is not null and d.created_at>=s.opened_at and d.created_at<=coalesce(s.completed_at,clock_timestamp()));
 select count(*) into acts from public.player_actions where game_id=p_game and author_id=p_student and round_no=p_stage and status='accepted';
 c:=case when cases_n>0 then 0.30*correct_cases::numeric/cases_n else 0 end;
 a:=0.30*least(1,acts::numeric/3);
 b:=case when total_q>0 then 0.30*correct_q::numeric/total_q else 0 end;
 completion:=case when total_q>0 then 0.10*answered_q::numeric/total_q else 0 end;
 return jsonb_build_object('score',round(c+a+b+completion,2),'cases',round(c,2),'actions',round(a,2),'blitz',round(b,2),'completion',round(completion,2),'cases_total',cases_n,'cases_right',correct_cases,'actions_right',acts,'quiz_total',total_q,'quiz_right',correct_q,'quiz_answered',answered_q);
end $function$
;
revoke all on function public.blitz_vsn(uuid,uuid,integer) from public,anon;
grant execute on function public.blitz_vsn(uuid,uuid,integer) to authenticated;
