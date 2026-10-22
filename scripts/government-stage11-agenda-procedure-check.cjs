'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const read=path=>fs.readFileSync(path,'utf8');
const code=read('components/game/GovernmentProgramSessionLab.tsx');
const migration=read('supabase/migrations/20261022103500_government_auto_agenda_chair_questions_vote.sql');
const details=read('components/game/stageDetails.ts');
const css=read('app/2026-october-refinement.css');
for(const s of [
 'create_government_session_from_programmes','sync_government_session_programmes',
 'approve_government_session_agenda','start_government_program_report',
 'ask_government_program_speaker','answer_government_program_speaker',
 'close_government_program_questions','open_program_vote_from_agenda',
 'sign_adopted_state_program','onOpenVotes(item.vote_id!)']){
 assert(code.includes(s),'Stage 11 UI is missing '+s);
}
for(const s of [
 "CREATE TABLE IF NOT EXISTS public.government_program_speaker_questions",
 "ALTER TABLE public.government_program_speaker_questions ENABLE ROW LEVEL SECURITY",
 "private.can_approve_government_agenda","private.role_is_available",
 "v.stage_no=11","p.status='government_vote'","p.status='ready'",
 "NOT EXISTS(SELECT 1 FROM public.game_ballots",
 "s.agenda_approved_at is null",
 "q.answer_text is null",
 "i.qa_closed_at is null",
 "private.require_game_meeting_registration",
 "NOT EXISTS(SELECT 1 FROM public.government_program_agenda",
 "IF s.status<>'draft'","REVOKE ALL ON FUNCTION public.ask_government_program_speaker"]){
 assert(migration.toLowerCase().includes(s.toLowerCase()),'Missing security or procedure gate '+s);
}
assert(!/UPDATE\s+public\.game_stages\s+SET\s+(?:status|deadline)/i.test(migration),'No stage opens or deadline changes');
assert(!/delete\s+from\s+public\.(?:game_votes|game_ballots|state_programs)/i.test(migration),'No history may be removed');
assert(details.includes('На Этапе 10 государственные программы не принимаются голосованием'),'Rules must distinguish stages');
assert(details.includes('После представления каждой программы'),'Stage 11 requires presentation');
assert(css.includes('var(--gs-accent)')&&css.includes('.govMeetingSpeakerQuestions'),'Use canonical design tokens');
assert(!/setInterval\(|new WebSocket|onSnapshot\(/.test(code),'No additional realtime or polling clients');
console.log('PASS: Government Stage 11 automatic agenda, chair approval, Q&A before votes, stage rules and security boundaries');
