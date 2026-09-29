-- Scheduled dispatch runs hourly in database, independently of student browser sessions.
select cron.schedule('gos-sims-event-autopilot-hourly','7 * * * *',
  'select private.run_all_game_autopilots()');
-- Set up a consistent baseline where a game predates the trust indicator.
insert into public.state_metrics(game_id,metric_key,label,value,unit,group_key,is_public)
select g.id,'public_trust','Доверие граждан',65,'%','society',true
from public.games g where not exists(
 select 1 from public.state_metrics sm where sm.game_id=g.id and sm.metric_key='public_trust');
-- Prepare the starter bank for existing games, without sending any events before teacher activation.
select private.seed_event_bank(id) from public.games;
insert into public.event_auto_settings(game_id,enabled)
select g.id,false from public.games g on conflict do nothing;