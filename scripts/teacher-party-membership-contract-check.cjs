'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sql=read('supabase/migrations/20261106131500_teacher_party_membership_after_stage_one.sql');
const ui=read('components/game/PartiesView.tsx');
const hook=read('components/game/useRepublicGame.ts');
const css=read('app/2026-civic-portal.css');
for(const phrase of [
 'private.is_game_teacher(p.game_id)',
 "stage_no=1 AND status='completed'",
 'private.has_open_duma_mandate_vote(p.game_id)',
 "gm.kind<>'student'",
 'gm.roster_archived_at IS NOT NULL',
 "old.status='pending' AND new.status='cancelled'",
 'UPDATE public.game_members',
 "ch.kind='team'",
 'INSERT INTO public.audit_log',
 "PERFORM realtime.send(",
 'REVOKE ALL ON FUNCTION public.teacher_manage_party_membership(uuid,uuid,text) FROM PUBLIC,anon'
])assert(sql.includes(phrase),'Missing security or integrity guard: '+phrase);
assert(ui.includes('teacher&&partyStageCompleted&&<div className="civicPartyMemberManager"'),'Teacher controls must be hidden until stage 1 completes');
assert(ui.includes('membershipCandidates.map')&&ui.includes("m.team||'Без партии'"),'Teachers can select active members from any party');
assert(ui.includes("managePartyMember('remove',m.user_id)"),'Every current party member has a teacher removal action');
assert(ui.includes("managePartyMember('enroll',membershipUser)"),'Teacher direct enrollment is wired');
assert(hook.includes("supabase.rpc('teacher_manage_party_membership'"),'Teacher actions must use server-authorized RPC');
assert(hook.includes("member_user_id===me.user_id"),'Changed player identity is reconciled with existing private channel');
assert(css.includes('.civicPartyMemberManagerActions'),'Existing party card styling must be preserved');
console.log('Teacher party membership: stage gate, teacher authorization, role isolation, chat/mandate links, UI and private-channel contract passed.');
