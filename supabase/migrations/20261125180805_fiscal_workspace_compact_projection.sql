-- One authorized budget-workspace response instead of three separate RPCs.
-- Preserve the existing single-argument API and its ledger for other consumers.
CREATE OR REPLACE FUNCTION public.get_fiscal_budget(p_game_id uuid, p_workspace boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_result jsonb; v_context jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры.' using errcode='42501';end if;
 if p_workspace is distinct from true then return public.get_fiscal_budget(p_game_id);end if;
 -- The existing authorised context RPC initializes the fiscal rows and settles due inflation once.
 v_context:=public.get_fiscal_context(p_game_id);
 select jsonb_build_object('regions',(select jsonb_agg(to_jsonb(r)||jsonb_build_object('name',d.name,'profile',d.profile,'disputed',d.disputed,'observations',d.observations,'source_url',d.source_url,'source_year',d.source_year) order by d.name) from game_fiscal_regions r join fiscal_region_reference d on d.code=r.region_code where game_id=p_game_id),'rates',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from game_fiscal_rates t where game_id=p_game_id),'proposals',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]'::jsonb) from fiscal_rate_proposals t where game_id=p_game_id),'can_propose',private.is_game_teacher(p_game_id) or exists(select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.kind='student' and private.role_is_available(p_game_id,auth.uid()) and lower(m.role_title) ~ 'министр|правительств|губернатор|глава|администрац')) into v_result;
 return v_result||jsonb_build_object('context',v_context,'programs',public.get_signed_state_program_budget(p_game_id));
end $function$;
REVOKE ALL ON FUNCTION public.get_fiscal_budget(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_fiscal_budget(uuid,boolean) TO authenticated;
-- Verify actual production-role projections in a rolled-back subtransaction.
DO $check$
DECLARE m record; old_f jsonb; old_c jsonb; old_p jsonb; new_f jsonb; gid uuid; tested integer:=0;
BEGIN
 IF has_function_privilege('anon','public.get_fiscal_budget(uuid,boolean)','EXECUTE') OR NOT has_function_privilege('authenticated','public.get_fiscal_budget(uuid,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected fiscal workspace privileges';END IF;
 SELECT id INTO gid FROM public.games WHERE status='running' AND EXISTS(SELECT 1 FROM public.budget_simulator_state s WHERE s.game_id=games.id) LIMIT 1;
 IF gid IS NOT NULL THEN
  BEGIN
   FOR m IN SELECT DISTINCT ON(kind) user_id,kind FROM public.game_members WHERE game_id=gid AND roster_archived_at IS NULL ORDER BY kind,user_id LOOP
    PERFORM set_config('request.jwt.claim.sub',m.user_id::text,true);
    new_f:=public.get_fiscal_budget(gid,true);
    old_f:=public.get_fiscal_budget(gid);
    old_c:=public.get_fiscal_context(gid);
    old_p:=public.get_signed_state_program_budget(gid);
    IF new_f-'context'-'programs' IS DISTINCT FROM old_f-'ledger' OR new_f->'context' IS DISTINCT FROM old_c OR new_f->'programs' IS DISTINCT FROM old_p OR new_f?'ledger' THEN RAISE EXCEPTION 'Workspace projection differs for role %',m.kind;END IF;
    tested:=tested+1;
   END LOOP;
   PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
   BEGIN
    PERFORM public.get_fiscal_budget(gid,true);
    RAISE EXCEPTION 'Unauthorized fiscal workspace access';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   RAISE SQLSTATE 'GX001' USING MESSAGE='Rollback test-only work';
  EXCEPTION WHEN SQLSTATE 'GX001' THEN NULL;
  END;
 END IF;
END $check$;
NOTIFY pgrst,'reload schema';
