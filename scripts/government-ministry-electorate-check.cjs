'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261022075500_government_ministry_appointment_electorate.sql','utf8');
const ui=fs.readFileSync('components/game/GovernmentProgramSessionLab.tsx','utf8');
const fixture=fs.readFileSync('scripts/october-budget-awards-browser-check.cjs','utf8');
for(const guard of [
 "p_institution='government'",
 "o.game_id=p_game and o.user_id=p_user",
 "o.status='active'",
 "gm.kind='student'",
 "gm.roster_archived_at is null",
 "private.role_is_available(p_game,p_user)",
 "'^министерство[[:space:]]+по[[:space:]]+'",
 "v.stage_no=11 AND v.status='open'",
 "p.status='government_vote' AND p.signed_at IS NOT NULL",
 "NOT EXISTS(SELECT 1 FROM public.game_ballots",
 "NOT EXISTS(SELECT 1 FROM public.government_program_agenda",
 "WHERE gm.game_id=old_vote.game_id",
 "'{weights}',roster",
 "'{eligible}',to_jsonb(eligible)",
])assert(sql.includes(guard),'Missing Government role/snapshot safety guard: '+guard);
assert(!/delete\s+from\s+(?:public\.)?(?:game_votes|game_ballots|state_programs|game_office_assignments)/i.test(sql),'Never delete historical data');
assert(!/update\s+public\.game_office_assignments|update\s+public\.game_members/i.test(sql),'Never rewrite current appointments');
assert(ui.includes('open_program_vote_from_agenda'),'Vote must be entered from Government agenda');
assert(fixture.includes('Государственные программы · Работа'),'Stage 10 uses existing Work programme source');
assert(!fixture.includes("getByRole('button',{name:'Государственная программа',exact:true}).click()"),'Legacy form duplication must remain removed');
console.log('PASS: active Government appointment, archived exclusion, zero-ballot roster correction and linked Work form');
