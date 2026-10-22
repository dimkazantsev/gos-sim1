'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261022075500_government_ministry_appointment_electorate.sql','utf8');
const ui=fs.readFileSync('components/game/GovernmentProgramSessionLab.tsx','utf8');
const game=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const preview=fs.readFileSync('components/GameClient.tsx','utf8');
const voting=fs.readFileSync('components/game/VotesView.tsx','utf8');
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
// Regression: both registered government ministers are frozen into the
// electorate; a stale display role must not hide the second vote button.
assert(game.includes("Number(v.electorate_snapshot.weights[me.user_id]||0)>0"),'Main voter checks the captured snapshot');
assert(!game.includes("v.institution_key.startsWith('unit:')||memberMatchesInstitution(me.user_id,v.institution_key)"),'Stale client role gate must not override the snapshot');
assert(preview.includes("Number(v.electorate_snapshot.weights[student.user_id]||0)>0"),'Student read-only preview reflects captured electorate');
assert(voting.includes('isRegisteredForVote(v)'),'Meeting registration remains mandatory');
assert(voting.includes('g.castVoteAllocation(v,yes,no,abstain)'),'Ballots still use the server RPC');
assert(ui.includes('className="govMeetingRefreshPrograms secondary"'),'Refresh button must use shared secondary design');
console.log('PASS: active Government appointment, two-member snapshot rights, meeting registration and linked Work form');
