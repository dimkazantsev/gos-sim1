-- Branches after rejection of the federal budget at first reading.
create or replace function public.start_budget_rejection_branch(
  p_document_id uuid,
  p_action text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_step jsonb;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null or d.workflow_key<>'budget' or d.status_code<>'reading1' then
  raise exception 'Budget is not at rejected first reading branch';
 end if;
 if not exists(
  select 1 from public.game_votes v
  where v.formal_document_id=d.id and v.formal_step_code='reading1'
    and v.status='closed' and v.result_code='rejected'
 ) then raise exception 'No rejected first-reading vote found';end if;
 if not (private.is_game_teacher(d.game_id) or private.can_close_procedural_vote(d.game_id,v_uid,'gd',d.id)) then
  raise exception 'Presiding State Duma authority required';
 end if;
 if p_action='conciliation' then
  update public.formal_documents
  set status_code='budget_conciliation',status_label='Согласительная комиссия после отклонения в I чтении',
      current_owner_key='committee',updated_at=now()
  where id=d.id;
 elsif p_action='government_revision' then
  v_step:=d.workflow_steps->1;
  update public.formal_documents
  set current_step=1,status_code='revision',status_label='Возвращён Правительству на доработку после I чтения',
      current_owner_key='government',updated_at=now()
  where id=d.id;
 else raise exception 'Unsupported budget rejection branch';end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 select d.id,d.game_id,v_uid,
  case when p_action='conciliation' then 'После отклонения бюджета в I чтении создана согласительная комиссия'
       else 'После отклонения бюджета в I чтении проект возвращён Правительству' end,
  d.status_code,fd.status_code,d.current_owner_key,fd.current_owner_key,p_note
 from public.formal_documents fd where fd.id=d.id;
end;
$$;
revoke all on function public.start_budget_rejection_branch(uuid,text,text) from public,anon;
grant execute on function public.start_budget_rejection_branch(uuid,text,text) to authenticated;
