-- Institutional NPA approval is not teacher moderation.
CREATE OR REPLACE FUNCTION private.institutional_formal_reviewer(p_subject text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog'
AS $review$ SELECT CASE p_subject
 WHEN 'ksrf' THEN 'ksrf'
 WHEN 'ks' THEN 'ks'
 WHEN 'vs' THEN 'vs'
 WHEN 'region' THEN 'region'
 WHEN 'gd' THEN 'gd_staff'
 WHEN 'gd_deputy' THEN 'gd_staff'
 WHEN 'sf' THEN 'sf'
 WHEN 'sf_member' THEN 'sf'
 WHEN 'president' THEN 'president'
 WHEN 'government' THEN 'government'
 WHEN 'ministry' THEN 'ministry'
 WHEN 'municipality' THEN 'municipality'
 ELSE 'author' END $review$;
REVOKE ALL ON FUNCTION private.institutional_formal_reviewer(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.set_generic_formal_institutional_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $route$
DECLARE reviewer text;
BEGIN
 IF NEW.workflow_key='generic'
 AND jsonb_typeof(NEW.workflow_steps)='array'
 AND jsonb_array_length(NEW.workflow_steps)>1
 AND NEW.workflow_steps->1->>'code'='review' THEN
  reviewer:=private.institutional_formal_reviewer(NEW.subject_key);
  IF NEW.workflow_steps->1->>'owner'='teacher' THEN
   NEW.workflow_steps:=jsonb_set(NEW.workflow_steps,'{1,owner}',to_jsonb(reviewer),true);
  END IF;
  IF NEW.current_step=1 AND NEW.current_owner_key='teacher' THEN
   NEW.current_owner_key:=NEW.workflow_steps->1->>'owner';
  END IF;
 END IF;
 RETURN NEW;
END;$route$;
REVOKE ALL ON FUNCTION private.set_generic_formal_institutional_owner() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS a_generic_formal_institutional_owner ON public.formal_documents;
CREATE TRIGGER a_generic_formal_institutional_owner
 BEFORE INSERT OR UPDATE OF workflow_steps,current_step,current_owner_key
 ON public.formal_documents FOR EACH ROW
 EXECUTE FUNCTION private.set_generic_formal_institutional_owner();

UPDATE public.formal_documents d
SET workflow_steps=jsonb_set(d.workflow_steps,'{1,owner}',to_jsonb(private.institutional_formal_reviewer(d.subject_key)),true),
 current_owner_key=CASE WHEN d.current_step=1 AND d.current_owner_key='teacher'
  THEN private.institutional_formal_reviewer(d.subject_key)
  ELSE d.current_owner_key END
WHERE d.workflow_key='generic'
 AND d.workflow_steps->1->>'code'='review'
 AND d.workflow_steps->1->>'owner'='teacher';

CREATE OR REPLACE FUNCTION private.matches_formal_owner(p_game uuid, p_user uuid, p_owner text, p_author uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select case
 when p_user is null or p_user is distinct from auth.uid() then false
 when p_owner='author' then p_user=p_author and exists(
   select 1 from public.game_members gm where gm.game_id=p_game
    and gm.user_id=p_user and gm.kind in ('student','teacher')
    and gm.roster_archived_at is null)
 when p_owner in ('system','teacher') then false
 when not exists(
   select 1 from public.game_members gm where gm.game_id=p_game
    and gm.user_id=p_user and gm.kind='student'
    and gm.roster_archived_at is null) then false
 when not private.role_is_available(p_game,p_user) then false
 else exists(select 1 from private.formal_user_roles(p_game,p_user) r where case p_owner
 when 'ksrf' then r like '%ксрф%'
 when 'ks' then r like '%конституционн%суд%'
 when 'vs' then r like '%верховн%суд%'
 when 'region' then r like '%законодательн%' or r like '%регион%'
 when 'president' then r like '%президент%'
 when 'gd_staff' then r like '%председател%' and r like '%дум%'
 when 'gd_council' then (r like '%совет%' or r like '%председател%') and r like '%дум%'
 when 'committee' then r like '%комитет%' or r like '%депутат%'
 when 'gd' then r like '%депутат%' or (r like '%государственн%' and r like '%дум%')
 when 'sf' then r like '%сенатор%' or r like '%совет федерац%'
 when 'government' then r like '%правительств%' or r like '%министр%'
 when 'ministry' then r like '%министр%' or r like '%министерств%'
 when 'municipality' then r like '%муницип%' or r like '%глава города%' or r like '%администрац%'
 else false end) end
$function$;

CREATE OR REPLACE FUNCTION public.get_formal_document_tools(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();manage boolean;open_vote boolean;editable boolean;signable boolean;next_step jsonb;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or not private.is_game_member(d.game_id) then raise exception 'Документ недоступен';end if;
 manage:=private.matches_formal_owner(d.game_id,u,d.current_owner_key,d.author_id);
 open_vote:=exists(select 1 from public.game_votes where formal_document_id=d.id and status='open');
 editable:=not open_vote and (private.is_game_teacher(d.game_id) or (manage and d.current_owner_key<>'system' and d.status_code not in ('signed','published','adopted','rejected')));
 next_step:=d.workflow_steps->(d.current_step+1);
 signable:=not open_vote and not private.formal_vote_required(d) and
 ((manage and coalesce(d.workflow_steps->d.current_step->>'action','') ilike '%подпис%')
 or ((d.metadata->>'signed_by'=u::text)
 and d.status_code in ('signed','published','adopted') and d.metadata ? 'revision_changed_at'
 and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz)));
 return jsonb_build_object('can_edit',editable,'can_manage',manage,'can_sign',signable,
 'can_copy',exists(select 1 from public.game_members where game_id=d.game_id and user_id=u and kind<>'observer'),
 'vote_required',private.formal_vote_required(d),'open_vote',open_vote,'next_owner',next_step->>'owner','next_action',d.workflow_steps->d.current_step->>'action');
end;$function$;
