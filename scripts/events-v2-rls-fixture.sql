ALTER TABLE public.event_cases ADD COLUMN allowed_roles text[] DEFAULT '{}',ADD COLUMN created_at timestamptz DEFAULT now();
CREATE TABLE public.event_discussion_messages(case_id uuid,game_id uuid,author_id uuid,body text);
CREATE OR REPLACE FUNCTION private.assigned_game_case(p_case uuid, p_game uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select exists(select 1 from public.event_assignments where case_id=p_case and game_id=p_game);
$function$;
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
CREATE OR REPLACE FUNCTION public.get_event_workspace_feed_bootstrap(p_game_id uuid, p_include_ready_count boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_snapshot jsonb; v_case_ids uuid[];
BEGIN
 v_snapshot := public.get_event_workspace_projection(p_game_id,p_include_ready_count);
 SELECT coalesce(array_agg(DISTINCT v.case_id),ARRAY[]::uuid[])
 INTO v_case_ids FROM (
  SELECT (item->>'case_id')::uuid AS case_id
  FROM jsonb_array_elements(v_snapshot->'assignments') AS item
  UNION ALL
  SELECT (item->>'case_id')::uuid
  FROM jsonb_array_elements(v_snapshot->'invitations') AS item
 ) v;
 RETURN v_snapshot || jsonb_build_object('compact',public.event_feed_compact_summary(p_game_id,v_case_ids));
END $function$;
GRANT USAGE ON SCHEMA auth,private,public TO authenticated;
GRANT SELECT ON public.game_members,public.event_assignments,public.event_decisions,public.event_case_outcomes,public.event_collaboration_invites,public.event_authority_evidence,public.event_discussion_messages TO authenticated;
GRANT SELECT (id,game_id,audience,status,decision_options,title,comic_scene,category,seriousness,case_key,allowed_roles,created_at) ON public.event_cases TO authenticated;
REVOKE ALL ON FUNCTION public.list_visible_event_cases(uuid,uuid[]),public.get_event_workspace_feed_bootstrap(uuid,boolean),public.event_feed_compact_summary(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_visible_event_cases(uuid,uuid[]),public.get_event_workspace_feed_bootstrap(uuid,boolean),public.event_feed_compact_summary(uuid,uuid[]) TO authenticated;
ALTER TABLE public.game_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_read ON public.game_members FOR SELECT TO authenticated USING (private.is_game_member(game_id));
ALTER TABLE public.event_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_assignment_public_read ON public.event_assignments FOR SELECT TO authenticated USING (private.is_game_member(game_id) OR private.is_game_teacher(game_id) OR recipient_id=auth.uid());
ALTER TABLE public.event_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_case_public_assigned ON public.event_cases FOR SELECT TO authenticated USING ((private.is_game_member(game_id) AND private.assigned_game_case(id,game_id)) OR private.is_game_teacher(game_id) OR EXISTS(SELECT 1 FROM public.event_assignments a WHERE a.case_id=event_cases.id AND a.game_id=event_cases.game_id AND a.recipient_id=auth.uid()));
ALTER TABLE public.event_authority_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY authority_evidence_read ON public.event_authority_evidence FOR SELECT TO authenticated USING (private.is_game_teacher(game_id) OR actor_id=auth.uid());

ALTER TABLE public.event_case_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_outcome_read ON public.event_case_outcomes FOR SELECT TO authenticated USING(private.is_game_member(game_id));
ALTER TABLE public.event_collaboration_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY collaboration_invites_read ON public.event_collaboration_invites FOR SELECT TO authenticated USING(private.is_game_member(game_id));
ALTER TABLE public.event_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_decision_public_read ON public.event_decisions FOR SELECT TO authenticated USING (private.is_game_member(game_id) OR private.is_game_teacher(game_id) OR EXISTS(SELECT 1 FROM public.event_assignments a WHERE a.case_id=event_decisions.case_id AND a.game_id=event_decisions.game_id AND a.recipient_id=auth.uid()));
ALTER TABLE public.event_discussion_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY discussion_fixture_read ON public.event_discussion_messages FOR SELECT TO authenticated USING(private.is_game_member(game_id));
