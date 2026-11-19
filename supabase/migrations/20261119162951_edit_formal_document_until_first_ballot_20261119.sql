-- An open vote alone does not freeze the document.
-- At the first cast ballot, editing is prohibited for everybody including the teacher.
-- Vote row locks are acquired in the same order as cast_vote_allocation;
-- indexed EXISTS checks add no browser requests or polling.
CREATE OR REPLACE FUNCTION public.get_formal_document_tools(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();manage boolean;open_vote boolean;has_ballot boolean;editable boolean;signable boolean;next_step jsonb;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or not private.is_game_member(d.game_id) then raise exception 'Документ недоступен';end if;
 manage:=d.status_code NOT IN ('rejected','superseded','withdrawn') AND private.matches_formal_owner(d.game_id,u,d.current_owner_key,d.author_id);
 open_vote:=exists(select 1 from public.game_votes where formal_document_id=d.id and status='open');
 -- An opened ballot is not yet a cast vote. Editing stops permanently
 -- once ANY linked vote has a ballot (open or closed), even from another user.
 has_ballot:=exists(
   select 1 from public.game_votes v join public.game_ballots b on b.vote_id=v.id
   where v.formal_document_id=d.id
 );
 editable:=not has_ballot and (private.is_game_teacher(d.game_id) or (manage and d.current_owner_key<>'system' and d.status_code not in ('signed','published','adopted','rejected')));
 next_step:=CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->(d.current_step+1) END;
 signable:=d.status_code NOT IN ('rejected','superseded','withdrawn') and not open_vote and not private.formal_vote_required(d) and
 ((manage and coalesce(d.workflow_steps->d.current_step->>'action','') ilike '%подпис%')
 or ((d.metadata->>'signed_by'=u::text)
 and d.status_code in ('signed','published','adopted') and d.metadata ? 'revision_changed_at'
 and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz)));
 return jsonb_build_object('can_edit',editable,'can_manage',manage,'can_sign',signable,
 'can_copy',exists(select 1 from public.game_members where game_id=d.game_id and user_id=u and kind<>'observer'),
 'vote_required',private.formal_vote_required(d),'open_vote',open_vote,'has_ballot',has_ballot,'next_owner',next_step->>'owner','next_action',CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->d.current_step->>'action' END);
end;$function$
;
CREATE OR REPLACE FUNCTION public.update_formal_draft(p_document_id uuid, p_title text, p_body_text text, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();access jsonb;rev integer;meta jsonb;change_note text;
begin
 -- Vote submission locks its parent vote first. Lock in the same order
 -- before editing, so concurrent first ballots cannot be overlooked.
 -- One indexed lookup, only on explicit Save (no polling or new API calls).
 perform v.id from public.game_votes v where v.formal_document_id=p_document_id
 order by v.id for update;
 select * into d from public.formal_documents where id=p_document_id for update;
 if exists(
   select 1 from public.game_votes v join public.game_ballots b on b.vote_id=v.id
   where v.formal_document_id=p_document_id
 ) then raise exception 'Редактирование запрещено: по документу уже подан голос';end if;
 access:=public.get_formal_document_tools(p_document_id);
 if not (access->>'can_edit')::boolean then raise exception 'Редактирование недоступно: проверьте полномочия или статус документа';end if;
 if p_metadata ? 'expected_revision' and (p_metadata->>'expected_revision')::integer<>coalesce((d.metadata->>'revision')::integer,1) then raise exception 'Документ уже изменён другим участником. Откройте текущую редакцию и повторите правку';end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Введите название документа';end if;
 if length(coalesce(p_body_text,''))>1000000 then raise exception 'Текст документа слишком большой';end if;
 meta:=d.metadata;
 if p_metadata ? 'issuer_name' then meta:=meta||jsonb_build_object('issuer_name',left(trim(p_metadata->>'issuer_name'),300));end if;
 if p_metadata ? 'place' then meta:=meta||jsonb_build_object('place',left(trim(p_metadata->>'place'),150));end if;
 if trim(p_title)=d.title and p_body_text is not distinct from d.body_text and meta=d.metadata then return;end if;
 rev:=coalesce((d.metadata->>'revision')::integer,1);
 insert into public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
 values(d.game_id,d.id,rev,d.title,d.body_text,d.metadata,u);
 meta:=meta||jsonb_build_object('revision',rev+1,'revision_changed_at',clock_timestamp(),'revision_changed_by',u);
 update public.formal_documents set title=trim(p_title),body_text=p_body_text,metadata=meta,updated_at=clock_timestamp() where id=d.id;
 change_note:=nullif(left(trim(coalesce(p_metadata->>'edit_note','')),2000),'');
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,u,'Сохранена редакция '||(rev+1),d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,change_note);
end;$function$
;
