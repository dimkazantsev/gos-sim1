-- QA-only connections after production function bodies have been installed.
-- This bridge is NOT a production API; it binds several REAL production
-- functions to the SAME disposable Auth, membership, game, and 16 stages.
create or replace function private.stage_readiness_json(p_game uuid,p_stage integer)
returns jsonb language sql stable security definer set search_path='public','private','pg_temp'
as $ready$
 select jsonb_build_object('ready',not exists(
   select 1 from jsonb_array_elements(private.stage_required_final_documents(p_game,p_stage)) row
   where not coalesce((row->>'fulfilled')::boolean,false)),
   'blockers',jsonb_build_array('Отсутствуют обязательные документы')) $ready$;
create trigger stage_final_document_readiness_guard
 before update of status on public.game_stages
 for each row execute function private.guard_stage_finalization();

-- This QA-only teacher method calls the original production impact function.
-- Do not add to the application schema or claim this represents the game RPC.
create function public.qa_apply_effect(p_game uuid,p_stage integer)
returns boolean language plpgsql security definer set search_path='public','private','pg_temp'
as $qa$
declare rule public.impact_rules%rowtype; result boolean;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game)
 then raise exception 'Teacher required' using errcode='42501';end if;
 if not exists(select 1 from public.game_stages
  where game_id=p_game and stage_no=p_stage and status='completed')
 then raise exception 'Stage not completed' using errcode='42501';end if;
 select * into rule from public.impact_rules
  where game_id=p_game and rule_key='stage-qa-'||p_stage;
 if rule.id is null then raise exception 'Missing QA effect rule';end if;
 result:=private.apply_rule_effects(p_game,rule,'stage','completed-'||p_stage,
   auth.uid(),jsonb_build_object('stage_no',p_stage),'Verified QA action');
 return result;
end;
$qa$;
revoke all on function public.qa_apply_effect(uuid,integer) from public,anon;
grant execute on function public.qa_apply_effect(uuid,integer) to authenticated;
notify pgrst,'reload schema';
