SET LOCAL lock_timeout = '2s';
CREATE OR REPLACE FUNCTION private.blitz_issue_offline_today()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare row record; total integer:=0; day_msk date:=(now() at time zone 'Europe/Moscow')::date;
begin
 for row in
  select m.game_id,m.user_id,g.current_round
  from public.game_members m join public.games g on g.id=m.game_id
  join public.game_stages s on s.game_id=g.id and s.stage_no=g.current_round
  where m.kind='student' and m.roster_archived_at is null and s.status='open'
  -- Already issued plans cannot produce a second set of questions.
  -- Keep the per-student transaction lock and recheck in blitz_issue_for_day
  -- for concurrent callers and preserve all issuance rules.
  and not exists (
   select 1 from public.blitz_daily_plans p
   where p.game_id=m.game_id and p.user_id=m.user_id and p.assigned_day=day_msk
  )
 loop
  total:=total+public.blitz_issue_for_day(row.game_id,row.user_id,day_msk,row.current_round);
 end loop;
 return total;
end $function$;
