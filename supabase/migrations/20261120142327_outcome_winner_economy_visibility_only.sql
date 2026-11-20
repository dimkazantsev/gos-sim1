-- ГОС.ID: post-outcome winner-only regional economic explanation.
-- Safe migration: no anonymous preview, no unpublished alternative effects,
-- no public grants or additional server calls.
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='12s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.list_visible_event_cases(uuid,uuid[])'::regprocedure)) <> 'f9baa019cd9e1e6c315ad53e4c5e0165' THEN
  RAISE EXCEPTION 'Event case visibility source changed since review';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.list_visible_event_cases(p_game_id uuid, p_case_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
 if (select auth.uid()) is null then
  raise exception 'Game authentication required' using errcode='42501';
 end if;
 if p_game_id is null or p_case_ids is null or cardinality(p_case_ids)>400 then
  raise exception 'Invalid case request' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(
   (to_jsonb(c)-'effect_plan')
    || jsonb_build_object('effect_plan',
      case
       when private.is_game_teacher(c.game_id) then c.effect_plan
       when won.case_id is not null
       then jsonb_build_object(
        'best_option_key',c.effect_plan->'best_option_key',
        'options',(
         select coalesce(jsonb_agg(
           (
            case when ('option_'||ordinal::text)=(c.effect_plan->>'best_option_key')
             then jsonb_build_object('trust',choice->'trust',
                  'description',choice->>'description','legal_basis',choice->>'legal_basis')
             else jsonb_build_object('trust',choice->'trust')
            end
            || case when ('option_'||ordinal::text)=won.winner
                then jsonb_build_object('fiscal_effect',choice->'fiscal_effect',
                     'description',choice->>'description')
                else '{}'::jsonb end
           ) order by ordinal),'[]'::jsonb)
         from jsonb_array_elements(coalesce(c.effect_plan->'options','[]'::jsonb))
               with ordinality as alternatives(choice,ordinal)
        )
       )
       else null
      end
    ) order by c.created_at,c.id
  ),'[]'::jsonb)
  into v_result
  from public.event_cases c
  left join public.event_case_outcomes won
    on won.case_id=c.id and won.game_id=c.game_id
  where c.game_id=p_game_id and c.id=any(p_case_ids)
    and (private.is_game_teacher(c.game_id)
         or (private.is_game_member(c.game_id) and private.assigned_game_case(c.id,c.game_id)));
 return v_result;
end $function$;
