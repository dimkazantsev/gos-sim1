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
