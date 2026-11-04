'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

const migration=fs.readFileSync('supabase/migrations/20261105030000_event_autopilot_start_current_stage.sql','utf8');
const original=fs.readFileSync('supabase/migrations/20261020083000_restore_approved_event_330_routing_after_duma.sql','utf8');
const panel=fs.readFileSync('components/game/EventAutopilotPanel.tsx','utf8');
const scheduled=fs.readFileSync('supabase/migrations/20260930010500_event_autopilot_schedule.sql','utf8');

const matrix=original.match(/v_stage_codes constant text:='([0-9a-f]+)'/);
assert.equal(matrix?.[1]?.length,330,'Keep original 330 event stage assignments');
assert.equal([...matrix[1]].filter(x=>x==='1').length,3,'Three cases are intentionally eligible before stage 6');
assert(migration.includes("greatest(1,m.early)"),'Respect original early-stage cases');
assert(migration.includes("v_dispatch := substring"),'Remove old stage 6 / election blocker without replacing the existing dispatcher');
assert(migration.includes('gm.roster_archived_at is null'), 'Preserve archived-student exclusion contract');
assert(migration.includes("ea.status=''pending''"),'Preserve pending case cap');
assert(migration.includes('private.ensure_event_case_routing(p_game)'), 'One-time routing initialization survives');
assert(migration.includes("IF p_enabled AND NOT coalesce(v_was_enabled,false) THEN"),'Dispatch only on disabled-to-enabled transition');
assert(migration.includes("PERFORM private.run_game_autopilot(p_game_id)"),'First dispatch occurs within the same teacher RPC');
assert(migration.includes("p_enabled AND NOT EXISTS("),'Skip unnecessary bank reseeding');
assert(migration.includes("s.last_run_at IS NULL"),'Only previously blocked enabled sessions receive one catch-up attempt');
assert(!/cron\.schedule|cron\.unschedule|CREATE TRIGGER|setInterval|\.channel\(/i.test(migration),'No new timer, cron or subscription');
assert(scheduled.includes("cron.schedule('gos-sims-event-autopilot-hourly'"),'Keep one existing server-side schedule');
assert(panel.includes("supabase.rpc('configure_game_event_autopilot'"),'Teacher uses the same existing RPC');
assert(!panel.includes("setInterval("),'No client polling');
console.log('PASS: same-stage teacher start, early-stage routing, rate/role guards, one RPC, no new polling.');
