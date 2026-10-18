-- No Presidential veto may be exercised by a teacher without the President.
-- Constitutional federal laws are not subject to ordinary Presidential veto.
CREATE OR REPLACE FUNCTION public.veto_formal_document(p_document_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 d public.formal_documents%rowtype;
 v_uid uuid:=(select auth.uid());
 v_status text;
 v_label text;
 v_owner text;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if d.current_owner_key<>'president' or d.status_code<>'president' then
   raise exception 'Document is not awaiting presidential decision';
 end if;
 -- The teacher cannot impersonate an unelected President.
 if d.doc_type='fkz_bill' then
   raise exception 'Президентское вето не применяется к федеральному конституционному закону'
     using errcode='42501';
 end if;
 if d.workflow_key not in ('bill','budget') then
   raise exception 'Вето Президента предусмотрено только для федерального закона'
     using errcode='42501';
 end if;
 if v_uid is null or not private.matches_formal_owner(d.game_id,v_uid,'president',d.author_id)
 then raise exception 'Решение вправе принять только действующий Президент Российской Федерации'
   using errcode='42501'; end if;

 if d.workflow_key='budget' then
   v_status:='budget_conciliation';
   v_label:='Согласительная комиссия после отклонения Президентом';
   v_owner:='committee';
 else
   v_status:='president_veto';
   v_label:='Отклонён Президентом Российской Федерации (вето)';
   v_owner:='gd_council';
 end if;

 update public.formal_documents
 set status_code=v_status,status_label=v_label,current_owner_key=v_owner,updated_at=now()
 where id=d.id;

 insert into public.formal_document_history(
  document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note
 ) values(
  d.id,d.game_id,v_uid,
  case when d.workflow_key='budget' then 'Президент отклонил закон о бюджете: созывается согласительная комиссия'
       else 'Президент отклонил федеральный закон (вето)' end,
  d.status_code,v_status,d.current_owner_key,v_owner,p_note
 );
end;
$function$;
