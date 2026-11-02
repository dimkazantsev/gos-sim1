-- Targeted RLS execution-plan optimization; existing predicates and roles are unchanged.
-- Only auth.uid() calls are cached per SQL statement; row-dependent checks stay row-dependent.
-- No policy removed, broadened, or made SECURITY DEFINER.
do $gos_rls$
declare item record;
declare original_qual text;
declare revised_qual text;
begin
 for item in
  select schemaname,tablename,policyname,qual from pg_policies
  where schemaname='public'
    and (tablename,policyname) in (
     ('bill_amendment_packs','bill_amendment_packs_member_read'),
     ('bill_amendments','bill_amendments_member_read'),
     ('presidential_campaign_materials','presidential_campaign_party_pending_read'),
     ('presidential_candidate_documents','gos_party_presidential_documents_read'),
     ('presidential_candidate_program_points','gos_party_presidential_program_read'),
     ('presidential_candidates','gos_party_presidential_candidate_read'),
     ('presidential_cec_complaints','cec_complaints_read'),
     ('presidential_cec_court_referrals','cec_court_referrals_read')
    )
 loop
  original_qual:=item.qual;
  -- Only plain function calls are transformed; existing (SELECT auth.uid()) remains untouched.
  revised_qual:=replace(original_qual,'auth.uid()','(select auth.uid())');
  -- Keep predicate semantics identical; a policy that no longer matches is not rewritten.
  if revised_qual<>original_qual then
   execute format('alter policy %I on %I.%I using (%s)',item.policyname,item.schemaname,item.tablename,revised_qual);
  end if;
 end loop;
end $gos_rls$;
