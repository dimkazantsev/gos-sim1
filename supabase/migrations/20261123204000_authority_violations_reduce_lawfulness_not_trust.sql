-- ГОС.ID 2026-11-23. No historical replay.
-- Authority/legality breaches decrease lawfulness, not trust.
-- Original effect_plan trust_delta and legal penalty (-3 per violation, cap -9) remain intact.
-- No new triggers, tables, background reads, subscriptions or grants.
DO $patch$
DECLARE
 v_def text;
 v_old_penalty constant text := 'v_authority_delta:=case when violations>0 then -greatest(0,new.requested_trust_delta)-least(6,violations*2) else 1 end;';
 v_new_penalty constant text := 'v_authority_delta:=case when violations>0 then 0 else 1 end;';
 v_old_call constant text := 'perform private.apply_event_trust_delta(c.game_id,''authority-''||c.id,v_authority_delta,''Полномочия в событии: ''||c.title);';
 v_new_call constant text := 'if v_authority_delta<>0 then' || E'\n  ' || v_old_call || E'\n end if;';
 v_lawfulness constant text := 'legal_delta:=case when violations>0 then -least(9,violations*3) else 2 end;';
BEGIN
 v_def:=pg_get_functiondef('private.record_event_authority()'::regprocedure);
 IF position(v_new_penalty in v_def)>0 AND position('if v_authority_delta<>0 then' in v_def)>0 THEN
  RETURN;
 END IF;
 IF position(v_old_penalty in v_def)=0 OR position(v_old_call in v_def)=0
    OR position(v_lawfulness in v_def)=0 THEN
  RAISE EXCEPTION 'ГОС.ID: authority function changed; review before patch';
 END IF;
 v_def:=replace(replace(v_def,v_old_penalty,v_new_penalty),v_old_call,v_new_call);
 EXECUTE v_def;
 IF position(v_new_penalty in pg_get_functiondef('private.record_event_authority()'::regprocedure))=0 THEN
  RAISE EXCEPTION 'ГОС.ID: authority patch not installed';
 END IF;
END $patch$;

-- Preserve existing collaboration limits while preventing more invitations
-- than the event's configured audience can actually accept. Case row is
-- already locked FOR UPDATE, so simultaneous inviters cannot overbook.
DO $invitations$
DECLARE
 v_def text;
 v_old_cap constant text := 'if (select count(*) from public.event_collaboration_invites where case_id=p_case and status in (''pending'',''accepted''))>=30 then raise exception ''Достигнут предел приглашений'';end if;';
 v_cap_guard constant text := 'if c.audience in (''single'',''group'') and ((select count(*) from public.event_assignments where case_id=p_case) + (select count(*) from public.event_collaboration_invites where case_id=p_case and status=''pending''))>=3 then raise exception ''Все места совместного решения заняты'';end if;';
 v_accept_new constant text := 'if p_accept then' || E'\n' ||
   '  if not exists (select 1 from public.game_members where game_id=i.game_id and user_id=auth.uid() and kind=''student'' and roster_archived_at is null) then raise exception ''Приглашение доступно только действующему участнику''; end if;';
BEGIN
 v_def:=pg_get_functiondef('public.invite_event_collaborator(uuid,uuid)'::regprocedure);
 IF position(v_cap_guard in v_def)=0 THEN
  IF position(v_old_cap in v_def)=0 THEN
   RAISE EXCEPTION 'ГОС.ID: invitation capacity source changed';
  END IF;
  EXECUTE replace(v_def,v_old_cap,v_cap_guard||E'\n '||v_old_cap);
 END IF;
 v_def:=pg_get_functiondef('public.respond_event_invitation(uuid,boolean)'::regprocedure);
 IF position('Приглашение доступно только действующему участнику' in v_def)=0 THEN
  IF position('if p_accept then' in v_def)=0 THEN
   RAISE EXCEPTION 'ГОС.ID: invitation acceptance source changed';
  END IF;
  EXECUTE replace(v_def,'if p_accept then',v_accept_new);
 END IF;
 IF position(v_cap_guard in pg_get_functiondef('public.invite_event_collaborator(uuid,uuid)'::regprocedure))=0
 OR position('Приглашение доступно только действующему участнику' in pg_get_functiondef('public.respond_event_invitation(uuid,boolean)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'ГОС.ID: invitation guards not installed';
 END IF;
END $invitations$;
