-- Restore game creation when the AFTER INSERT game triggers already seeded metrics.
-- Patch the existing function in place to preserve its role checks, 16 stages and all other logic.
do $repair$
declare current_definition text;
declare old_tail text := '(g,''security'',''Безопасность'',73,''%'');';
declare new_tail text := '(g,''security'',''Безопасность'',73,''%'') on conflict (game_id,metric_key) do nothing;';
begin
  select pg_get_functiondef('public.create_game_session(text,text,text,text,text)'::regprocedure)
    into current_definition;
  if position(new_tail in current_definition) > 0 then
    return;
  end if;
  if position(old_tail in current_definition) = 0 then
    raise exception 'Unexpected create_game_session definition; manual review required';
  end if;
  execute replace(current_definition,old_tail,new_tail);
end;
$repair$;
