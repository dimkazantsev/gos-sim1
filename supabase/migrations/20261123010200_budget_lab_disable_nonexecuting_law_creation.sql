-- Preserve existing document IDs for authorized access, but stop the
-- independent analytic route from generating federal budget laws lacking
-- the snapshot/financing/annexes required for execution. The official
-- simulator remains the one legal source of such new documents.
CREATE OR REPLACE FUNCTION public.create_budget_document_from_scenario(p_scenario_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Budget scenario not found';end if;
 -- Preserve access to an existing lawful document, including an older link,
 -- but never create a second law without the simulator's financial annexes.
 if not private.is_game_teacher(s.game_id)
    and not private.has_effective_role_like(s.game_id,v_uid,
      ARRAY['%председател%правительств%','%министр%финанс%','%правительств%'])
 then raise exception 'Government / Finance Ministry access required';end if;
 if s.status<>'final' then raise exception 'Finalize the budget scenario first';end if;
 if s.formal_document_id is not null then return s.formal_document_id;end if;
 raise exception 'Аналитический сценарий не является проектом исполняемого федерального бюджета. Подготовьте общий расчёт и закон с числовыми приложениями в разделе «Бюджет».';
end;$function$;
