-- Repeated opening reuses the ballot for this exact stage; stale results cannot advance another stage.
CREATE OR REPLACE FUNCTION public.create_procedural_vote(p_game_id uuid, p_title text, p_body text, p_voting_mode text, p_institution_key text, p_procedure_key text, p_quorum_kind text DEFAULT 'fraction'::text, p_quorum_value numeric DEFAULT 0.6666667, p_majority_kind text DEFAULT 'yes_no_simple'::text, p_majority_value numeric DEFAULT 0.5, p_allow_abstain boolean DEFAULT true, p_tie_breaker_chair boolean DEFAULT false, p_formal_document_id uuid DEFAULT NULL::uuid, p_pass_transition text DEFAULT 'none'::text, p_fail_transition text DEFAULT 'none'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid:=(select auth.uid());
  v_id uuid:=gen_random_uuid();
  d public.formal_documents%rowtype;
  v_step_code text;
  v_existing uuid;
begin
  if v_uid is null or not private.is_game_member(p_game_id) then
    raise exception 'Game access required';
  end if;
  if p_voting_mode not in ('member','faction','mandate') then
    raise exception 'Unsupported voting mode';
  end if;
  if length(trim(coalesce(p_title,'')))<3 then
    raise exception 'Vote title is required';
  end if;

  if p_formal_document_id is not null then
    select * into d from public.formal_documents where id=p_formal_document_id for update;
    if d.id is null or d.game_id<>p_game_id then raise exception 'Formal document not found'; end if;
    if not (
      private.is_game_teacher(p_game_id)
      or private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id)
    ) then raise exception 'Current institution cannot open this vote'; end if;
    v_step_code:=d.status_code;
    select id into v_existing from public.game_votes where formal_document_id=d.id and formal_step_code=v_step_code and status='open' order by opened_at limit 1;
    if v_existing is not null then return v_existing; end if;
  else
    if not private.is_game_teacher(p_game_id) then
      raise exception 'Only teacher can open an unlinked vote';
    end if;
  end if;

  insert into public.game_votes(
    id,game_id,stage_no,title,body,voting_mode,created_by,
    formal_document_id,formal_step_code,institution_key,procedure_key,
    quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,
    pass_transition,fail_transition
  )
  values(
    v_id,p_game_id,coalesce(d.stage_no,1),trim(p_title),nullif(trim(coalesce(p_body,'')),''),
    p_voting_mode,v_uid,p_formal_document_id,v_step_code,p_institution_key,p_procedure_key,
    p_quorum_kind,p_quorum_value,p_majority_kind,p_majority_value,p_allow_abstain,p_tie_breaker_chair,
    p_pass_transition,p_fail_transition
  );
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.apply_formal_vote_transition(p_document uuid, p_transition text, p_actor uuid, p_vote uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 d public.formal_documents%rowtype;
 v_step jsonb;
 v_next integer;
 v_action text;
begin
 if p_document is null or p_transition='none' then return; end if;
 select * into d from public.formal_documents where id=p_document for update;
 if d.id is null then return; end if;
 if not exists(select 1 from public.game_votes where id=p_vote and formal_document_id=d.id and formal_step_code=d.status_code) then
  update public.game_votes set decision_note=concat_ws(' · ',decision_note,'Стадия документа изменилась; результат сохранён без перехода') where id=p_vote;
  return;
 end if;

 if p_transition='advance' then
   if d.workflow_key='bill' and d.status_code='reading3' then
     v_next:=d.current_step+2;
     v_step:=d.workflow_steps->v_next;
     update public.formal_documents
       set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
           current_owner_key=v_step->>'owner',updated_at=now()
     where id=d.id;
     v_action:='Закон принят ГД; Совет Федерации автоматически одобрил его по правилам игры; направлен Президенту';
   else
     v_next:=d.current_step+1;
     if v_next>=jsonb_array_length(d.workflow_steps) then return; end if;
     v_step:=d.workflow_steps->v_next;
     update public.formal_documents
       set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
           current_owner_key=v_step->>'owner',updated_at=now()
     where id=d.id;
     v_action:='Документ продвинут по результатам голосования';
   end if;
 elsif p_transition='reject' then
   update public.formal_documents
     set status_code='rejected',status_label='Отклонён голосованием',current_owner_key='system',updated_at=now()
   where id=d.id;
   v_action:='Документ отклонён голосованием';
 elsif p_transition='return_author' then
   v_step:=d.workflow_steps->0;
   update public.formal_documents
     set current_step=0,status_code='revision',status_label='Возвращён автору по результатам голосования',
         current_owner_key='author',updated_at=now()
   where id=d.id;
   v_action:='Документ возвращён автору по результатам голосования';
 elsif p_transition='return_previous' then
   v_next:=greatest(0,d.current_step-1);
   v_step:=d.workflow_steps->v_next;
   update public.formal_documents
     set current_step=v_next,status_code='revision',status_label='Возвращён на предыдущую стадию',
         current_owner_key=v_step->>'owner',updated_at=now()
   where id=d.id;
   v_action:='Документ возвращён на предыдущую стадию по результатам голосования';
 else
   return;
 end if;

 insert into public.formal_document_history(
  document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note
 )
 select d.id,d.game_id,p_actor,v_action,d.status_code,fd.status_code,
        d.current_owner_key,fd.current_owner_key,
        'Голосование '||p_vote::text||coalesce(' · '||nullif(p_note,''),'')
 from public.formal_documents fd where fd.id=d.id;
end;
$function$;

revoke all on function private.apply_formal_vote_transition(uuid,text,uuid,uuid,text) from public,anon,authenticated;
