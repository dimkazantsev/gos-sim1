-- V2 release candidate; install atomically with other candidates, not separately.
-- Retain existing same-game visibility for active members and guests. The
-- restrictive predicate closes self-row exceptions for removed/blocked accounts.
DO $guard$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['event_cases','event_assignments','event_decisions','event_case_outcomes','event_collaboration_invites','event_authority_evidence','event_discussion_messages'] LOOP
  EXECUTE format('CREATE POLICY event_active_game_access_v2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (private.is_game_member(game_id)) WITH CHECK (private.is_game_member(game_id))',tab);
  EXECUTE format('REVOKE TRUNCATE ON public.%I FROM PUBLIC,anon,authenticated',tab);
 END LOOP;
END $guard$;
CREATE OR REPLACE FUNCTION public.cancel_event_invitation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$ declare i public.event_collaboration_invites%rowtype; begin select * into i from public.event_collaboration_invites where id=p_id; if i.id is null or not private.is_game_member(i.game_id) then raise exception 'Приглашение недоступно'; end if; perform 1 from public.event_cases where id=i.case_id for update; if i.inviter_id<>auth.uid() and not private.is_game_teacher(i.game_id) then raise exception 'Приглашение недоступно'; end if; if exists(select 1 from public.event_decisions where case_id=i.case_id) then raise exception 'Голосование уже началось'; end if; update public.event_collaboration_invites set status='cancelled',responded_at=now() where id=p_id and status='pending'; end;$function$;
CREATE OR REPLACE FUNCTION public.send_event_discussion(p_case uuid, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;
begin
 select * into c from public.event_cases where id=p_case;
 if c.id is null or not private.is_game_member(c.game_id) or not exists(select 1 from public.game_members where game_id=c.game_id and user_id=auth.uid() and kind<>'observer') or not (private.is_game_teacher(c.game_id) or exists(select 1 from public.event_assignments where case_id=p_case and recipient_id=auth.uid())) then raise exception 'Обсуждение недоступно';end if;
 if exists(select 1 from public.event_case_outcomes where case_id=p_case) then raise exception 'Обсуждение завершено';end if;
 insert into public.event_discussion_messages(case_id,game_id,author_id,body) values(p_case,c.game_id,auth.uid(),trim(p_body));
end;$function$;
CREATE OR REPLACE FUNCTION private.event_winning_outcomes_visible(p_game_id uuid, p_case_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid := (SELECT auth.uid());
 v_teacher boolean;
 v_observer boolean;
 v_results jsonb;
BEGIN
 IF v_actor IS NULL OR p_game_id IS NULL OR cardinality(p_case_ids)>400
    OR NOT private.is_game_member(p_game_id) THEN
   RAISE EXCEPTION 'Нет доступа к событиям этой игры.' USING ERRCODE='42501';
 END IF;
 v_teacher:=private.is_game_teacher(p_game_id);
 SELECT EXISTS(SELECT 1 FROM public.game_members gm
   WHERE gm.game_id=p_game_id AND gm.user_id=v_actor AND gm.kind='observer'
     AND gm.roster_archived_at IS NULL) INTO v_observer;
 IF NOT v_teacher AND NOT v_observer AND coalesce(cardinality(p_case_ids),0)=0 THEN
   RETURN '{}'::jsonb;
 END IF;
 -- Definer access is limited to outcomes that already exist. Do not expose
 -- a nonwinning option, case text, or the source effect_plan column.
 SELECT coalesce(jsonb_object_agg(o.case_id::text,jsonb_build_object(
   'winning_fiscal_effect',CASE WHEN o.winner ~ '^option_[1-9][0-9]*$'
     THEN c.effect_plan->'options'->(substring(o.winner from 8)::integer-1)->'fiscal_effect'
     ELSE NULL END,
   'winning_description',CASE WHEN o.winner ~ '^option_[1-9][0-9]*$'
     THEN c.effect_plan->'options'->(substring(o.winner from 8)::integer-1)->>'description'
     ELSE NULL END)), '{}'::jsonb)
 INTO v_results
 FROM public.event_case_outcomes o
 JOIN public.event_cases c ON c.id=o.case_id AND c.game_id=o.game_id
 WHERE o.game_id=p_game_id
   AND (v_teacher OR v_observer
        OR (o.case_id=ANY(p_case_ids)
            AND (EXISTS(SELECT 1 FROM public.event_assignments a
                  WHERE a.game_id=o.game_id AND a.case_id=o.case_id AND a.recipient_id=v_actor)
              OR EXISTS(SELECT 1 FROM public.event_collaboration_invites i
                  WHERE i.game_id=o.game_id AND i.case_id=o.case_id AND (i.recipient_id=v_actor OR (i.inviter_id=v_actor AND i.transfer_stage_no IS NOT NULL))))));
 RETURN v_results;
END;
$function$;
REVOKE ALL ON FUNCTION public.invite_event_collaborator(uuid,uuid),public.respond_event_invitation(uuid,boolean),public.cancel_event_invitation(uuid),public.send_event_discussion(uuid,text),public.submit_event_decision(uuid,text,text),public.finalize_event_case(uuid),public.get_event_decision_feedback(uuid),public.get_event_workspace_projection(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invite_event_collaborator(uuid,uuid),public.respond_event_invitation(uuid,boolean),public.cancel_event_invitation(uuid),public.send_event_discussion(uuid,text),public.submit_event_decision(uuid,text,text),public.finalize_event_case(uuid),public.get_event_decision_feedback(uuid),public.get_event_workspace_projection(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_event_case(p_case_id uuid, p_recipients uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;recipient uuid;n integer:=0;recipients uuid[];v_stage integer;v_v2 boolean;v_existing uuid[];v_region uuid[];v_regional boolean:=false;
begin
 select * into c from public.event_cases where id=p_case_id for update;
 if c.id is null or not private.is_game_teacher(c.game_id) then raise exception 'Требуются права преподавателя';end if;
 if c.status<>'ready' or exists(select 1 from public.event_case_outcomes where case_id=c.id)
 then raise exception 'Событие недоступно для назначения';end if;
 v_v2:=coalesce(c.effect_plan->>'rules_version'='2',false);
 select array_agg(distinct v order by v) into recipients from unnest(p_recipients) v where v is not null;
 if coalesce(cardinality(recipients),0)=0 then raise exception 'Выберите получателей';end if;
 if c.audience='single' and cardinality(recipients)<>1 then raise exception 'Выберите одного участника';end if;
 if c.audience='group' and cardinality(recipients) not between 2 and 3 then raise exception 'Выберите 2–3 участников';end if;
 if exists(select 1 from unnest(recipients) r where not exists(select 1 from public.game_members
  where game_id=c.game_id and user_id=r and kind='student' AND (NOT v_v2 OR (roster_archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.game_member_access_blocks b WHERE b.game_id=c.game_id AND b.user_id=r))))) then raise exception 'Получатель недоступен';end if;
 IF v_v2 AND c.audience IN ('group','all') AND EXISTS(SELECT 1 FROM public.event_case_routing r WHERE r.game_id=c.game_id AND r.case_id=c.id AND r.destination IN ('regional','regional_joint')) THEN
  v_regional:=true;v_region:=private.event_v2_regional_roster(c.game_id,c.id);
  IF cardinality(v_region)<2 THEN RAISE EXCEPTION 'Недостаточно участников контролирующей партии';END IF;
  IF NOT recipients <@ v_region OR (c.audience='all' AND recipients<>v_region) THEN RAISE EXCEPTION 'Назначение только участникам контролирующей партии, для общего голосования — всей партии';END IF;
 END IF;
 if not v_regional AND c.audience='all' and cardinality(recipients)<>(select count(*) from public.game_members where game_id=c.game_id and kind='student' AND (NOT v_v2 OR (roster_archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.game_member_access_blocks b WHERE b.game_id=c.game_id AND b.user_id=game_members.user_id))))
 then raise exception 'Общее событие назначается всем участникам';end if;
 -- The stage comes from the teacher's assignment context, not the largest
 -- concurrently opened stage. Legacy clients use the explicit game round.
 v_stage:=nullif(current_setting('app.gos_event_stage',true),'')::integer;
 if v_stage is null then
   select g.current_round into v_stage from public.games g where g.id=c.game_id;
 end if;
 if v_stage not between 1 and 16 or not exists(
     select 1 from public.game_stages s
     where s.game_id=c.game_id and s.stage_no=v_stage and s.status='open')
 then raise exception 'Для назначения ситуации выберите открытый этап игры' using errcode='23514';end if;
 IF v_regional AND NOT EXISTS(SELECT 1 FROM public.event_case_routing r WHERE r.game_id=c.game_id AND r.case_id=c.id AND v_stage BETWEEN r.earliest_stage AND r.latest_stage) THEN RAISE EXCEPTION 'Региональная ситуация недоступна на этом этапе';END IF;
 IF v_v2 AND c.audience IN ('group','all') THEN
  SELECT array_agg(a.recipient_id ORDER BY a.recipient_id) INTO v_existing FROM public.event_assignments a WHERE a.case_id=c.id AND a.game_id=c.game_id;
  IF v_existing IS NOT NULL THEN
   IF v_existing=recipients AND NOT EXISTS(SELECT 1 FROM public.event_assignments a WHERE a.case_id=c.id AND a.stage_no IS DISTINCT FROM v_stage) THEN RETURN 0;END IF;
   RAISE EXCEPTION 'Состав коллективного голосования уже зафиксирован';
  END IF;
 END IF;
 -- One set-based INSERT statement for all recipients: one trigger broadcast
 -- and one database round of assignment checks instead of up to 100 statements.
 INSERT INTO public.event_assignments(case_id,game_id,recipient_id,created_by,stage_no)
 SELECT c.id,c.game_id,r.user_id,auth.uid(),v_stage
 FROM unnest(recipients) AS r(user_id)
 ON CONFLICT(case_id,recipient_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 return n;
end;
$function$;
CREATE OR REPLACE FUNCTION public.assign_event_case_at_stage(p_case_id uuid, p_recipients uuid[], p_stage_no integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_game uuid;
BEGIN
 SELECT game_id INTO v_game FROM public.event_cases WHERE id=p_case_id;
 IF v_game IS NULL OR NOT private.is_game_teacher(v_game) THEN
   RAISE EXCEPTION 'Требуются права преподавателя' USING ERRCODE='42501';
 END IF;
 IF p_stage_no NOT BETWEEN 1 AND 16 OR NOT EXISTS(
   SELECT 1 FROM public.game_stages s WHERE s.game_id=v_game AND s.stage_no=p_stage_no AND s.status='open')
 THEN RAISE EXCEPTION 'Выберите открытый этап для этой ситуации' USING ERRCODE='23514';END IF;
 PERFORM set_config('app.gos_event_stage',p_stage_no::text,true);
 RETURN public.assign_event_case(p_case_id,p_recipients);
END
$function$;
REVOKE ALL ON FUNCTION public.assign_event_case(uuid,uuid[]),public.assign_event_case_at_stage(uuid,uuid[],integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_event_case(uuid,uuid[]),public.assign_event_case_at_stage(uuid,uuid[],integer) TO authenticated;

CREATE OR REPLACE FUNCTION private.event_assignment_legacy(p_game uuid,p_case uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
 SELECT private.is_game_teacher(p_game) AND EXISTS(SELECT 1 FROM public.event_cases c WHERE c.game_id=p_game AND c.id=p_case AND NOT coalesce(c.effect_plan->>'rules_version'='2',false))
$f$;
REVOKE ALL ON FUNCTION private.event_assignment_legacy(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.event_assignment_legacy(uuid,uuid) TO authenticated;
CREATE POLICY event_assignment_legacy_insert ON public.event_assignments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(private.event_assignment_legacy(game_id,case_id));
CREATE POLICY event_assignment_legacy_update ON public.event_assignments AS RESTRICTIVE FOR UPDATE TO authenticated USING(private.event_assignment_legacy(game_id,case_id)) WITH CHECK(private.event_assignment_legacy(game_id,case_id));
CREATE POLICY event_assignment_legacy_delete ON public.event_assignments AS RESTRICTIVE FOR DELETE TO authenticated USING(private.event_assignment_legacy(game_id,case_id));

-- One lazy teacher-only projection for the regional bank. No per-case or per-player request.
CREATE OR REPLACE FUNCTION public.get_event_v2_regional_assignment_context(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE result jsonb;
BEGIN
 IF NOT private.is_game_teacher(p_game_id) THEN RAISE EXCEPTION 'Требуются права преподавателя' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('regions',coalesce((SELECT jsonb_object_agg(r.region_code,r.party_id) FROM public.game_region_party_control r WHERE r.game_id=p_game_id AND r.fixed_at IS NOT NULL),'{}'::jsonb),
 'parties',coalesce((SELECT jsonb_object_agg(p.id::text,jsonb_build_object('name',p.name,'members',coalesce((SELECT jsonb_agg(m.user_id ORDER BY m.user_id) FROM public.game_members m WHERE m.game_id=p.game_id AND m.team=p.name AND m.kind='student' AND m.roster_archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.game_member_access_blocks b WHERE b.game_id=m.game_id AND b.user_id=m.user_id)),'[]'::jsonb))) FROM public.game_parties p WHERE p.game_id=p_game_id),'{}'::jsonb)) INTO result;
 RETURN result;
END $f$;
REVOKE ALL ON FUNCTION public.get_event_v2_regional_assignment_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_event_v2_regional_assignment_context(uuid) TO authenticated;
