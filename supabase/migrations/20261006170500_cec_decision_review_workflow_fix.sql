-- CEC final decision workflow: teacher/CEC decides after submitted package review,
-- while automatic analysis remains advisory and is captured in the decision reasoning snapshot.
create or replace function public.record_presidential_cec_decision(
 p_candidate_id uuid,p_status text,p_legal_errors integer,p_rating_penalty numeric,p_public_summary text,p_private_summary text
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 c public.presidential_candidates%rowtype;
 v_uid uuid:=(select auth.uid());
 v_id uuid;v_seq bigint;v_decision_no text;v_registration_no text;v_public text;
 v_reasoning jsonb;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id for update;
 if c.id is null then raise exception 'Candidate not found'; end if;
 if not private.is_game_teacher(c.game_id) then raise exception 'Election commission / teacher access required'; end if;
 if c.cec_submitted_at is null then raise exception 'Candidate package has not been submitted to CEC';end if;
 if p_status not in ('registered','revision','rejected','withdrawn') then raise exception 'Unsupported CEC decision'; end if;
 if p_legal_errors<0 then raise exception 'Legal error count cannot be negative'; end if;
 if p_rating_penalty<0 or p_rating_penalty>100 then raise exception 'Penalty must be 0-100'; end if;

 v_reasoning:=private.presidential_submission_review_json(c.id);
 v_seq:=nextval('public.presidential_cec_decision_seq');
 v_decision_no:='ЦИК-'||to_char(current_date,'YYYY')||'-'||lpad(v_seq::text,4,'0');
 v_registration_no:=case when p_status='registered' then 'КП-'||to_char(current_date,'YYYY')||'-'||lpad(v_seq::text,4,'0') else c.registration_number end;
 v_public:=coalesce(nullif(trim(coalesce(p_public_summary,'')),''),
   case p_status
    when 'registered' then 'Зарегистрировать кандидата по результатам рассмотрения представленного пакета документов.'
    when 'revision' then 'Вернуть документы на доработку с учетом перечисленных в мотивировочной части замечаний.'
    when 'rejected' then 'Отказать в регистрации кандидата по основаниям, изложенным в мотивировочной части решения.'
    else 'Прекратить участие кандидата в процедуре.'
   end);

 insert into public.presidential_cec_decisions(game_id,candidate_id,decision_type,decision_number,public_summary,created_by,reasoning)
 values(c.game_id,c.id,p_status,v_decision_no,v_public,v_uid,v_reasoning) returning id into v_id;

 insert into public.presidential_cec_private_notes(decision_id,game_id,candidate_id,private_summary,created_by)
 values(v_id,c.game_id,c.id,nullif(trim(coalesce(p_private_summary,'')),''),v_uid);

 if p_status='registered' then
  update public.presidential_candidate_documents
  set status='accepted',note=null,reviewed_by=v_uid,updated_at=now()
  where candidate_id=c.id and is_submitted;
 elsif p_status in ('revision','rejected') then
  update public.presidential_candidate_documents d
  set status=case when coalesce(d.auto_check->>'verdict','manual')='issues' then 'revision' else d.status end,
      note=case when coalesce(d.auto_check->>'verdict','manual')='issues'
       then coalesce(nullif(d.auto_check->>'summary',''),'Требуется устранить замечания автоматической предварительной проверки.')
       else d.note end,
      reviewed_by=case when coalesce(d.auto_check->>'verdict','manual')='issues' then v_uid else d.reviewed_by end,
      updated_at=now()
  where d.candidate_id=c.id and d.is_submitted;
 end if;

 update public.presidential_candidates
 set registration_status=p_status,legal_error_count=p_legal_errors,rating_penalty=p_rating_penalty,
     registration_number=v_registration_no,registration_decision_no=v_decision_no,registration_decision_at=now(),
     registration_public_summary=v_public,updated_at=now()
 where id=c.id;
 return v_id;
end;$$;
revoke all on function public.record_presidential_cec_decision(uuid,text,integer,numeric,text,text) from public,anon;
grant execute on function public.record_presidential_cec_decision(uuid,text,integer,numeric,text,text) to authenticated;

update public.presidential_candidates c
set cec_submitted_at=coalesce(c.cec_submitted_at,c.registration_decision_at,c.updated_at),
    cec_submission_version=greatest(cec_submission_version,1)
where c.cec_submitted_at is null
  and (c.registration_decision_no is not null or c.registration_status in ('registered','revision','rejected'));

update public.presidential_candidate_documents d
set is_submitted=true,submitted_at=coalesce(submitted_at,d.updated_at)
where not d.is_submitted
  and exists(select 1 from public.presidential_candidates c where c.id=d.candidate_id and c.cec_submitted_at is not null);
