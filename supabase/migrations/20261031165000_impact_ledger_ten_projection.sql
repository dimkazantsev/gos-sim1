-- ГОС.ID: Последствия решений: не более 10 последних записей в серверной проекции.
-- Все более ранние записи остаются в impact_ledger; начисления и откаты не меняются.
-- Изменяется только ограничение чтения; исходный SECURITY INVOKER и RLS сохраняются.
-- The original scoring/effect RPCs are not changed.
-- SECURITY INVOKER keeps both original RLS policies. No materialized data or trigger.
create or replace function public.get_impact_engine_projection(p_game_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.is_game_member(p_game_id) then
    raise exception 'Нет доступа к игре.' using errcode='42501';
  end if;

  return jsonb_build_object(
    'rules',coalesce((
      select jsonb_agg(to_jsonb(rule_row) order by rule_row.priority)
      from (select * from public.impact_rules where game_id=p_game_id order by priority) rule_row
    ),'[]'::jsonb),
    'ledger',coalesce((
      select jsonb_agg(to_jsonb(ledger_row) order by ledger_row.created_at desc)
      from (select * from public.impact_ledger where game_id=p_game_id
        order by created_at desc limit 10) ledger_row
    ),'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_impact_engine_projection(uuid) from public, anon;
grant execute on function public.get_impact_engine_projection(uuid) to authenticated;
