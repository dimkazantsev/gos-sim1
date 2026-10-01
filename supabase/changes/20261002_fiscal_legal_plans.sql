-- Read-only projection of structured budget work and its legal status.
-- Financial assumptions in the shared regional model remain teacher-controlled.
create or replace function public.get_fiscal_legal_plans(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare answer jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры';end if;
 select jsonb_build_object('plans',(select coalesce(jsonb_agg(to_jsonb(x) order by x.budget_year desc,x.updated_at desc),'[]') from (
  select s.id,s.title,s.budget_year,s.source_note,s.revenue,s.expenditure,s.balance,s.debt_end,s.financing,s.updated_at,
   case when s.status='final' and d.doc_type='federal_budget' and d.status_code='published' and d.metadata->>'budget_scenario_id'=s.id::text then 'published' when s.status='final' then 'ready' else 'draft' end legal_status,
   d.id document_id,d.registry_no,d.status_label document_status,
   (select coalesce(jsonb_agg(jsonb_build_object('program_id',p.id,'title',p.title,'ministry',p.responsible_ministry,'amount',a.amount) order by p.title),'[]')
    from budget_program_allocations a join state_programs p on p.id=a.program_id and p.game_id=p_game_id and p.status='adopted'
    where a.scenario_id=s.id and a.game_id=p_game_id) allocations
  from budget_scenarios s left join formal_documents d on d.id=s.formal_document_id and d.game_id=p_game_id
  where s.game_id=p_game_id order by s.budget_year desc,s.updated_at desc limit 20
 ) x),'programs',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'ministry',p.responsible_ministry,'total_budget',p.total_budget,'vote_id',p.government_vote_id) order by p.title),'[]') from state_programs p where p.game_id=p_game_id and p.status='adopted')) into answer;
 return answer;
end$$;
revoke all on function public.get_fiscal_legal_plans(uuid) from public,anon;
grant execute on function public.get_fiscal_legal_plans(uuid) to authenticated;

