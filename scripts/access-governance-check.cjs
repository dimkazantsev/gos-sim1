/* Focused, non-destructive contract checks for access governance. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const sql=read('supabase/migrations/20261013231000_access_governance.sql');
const code=read('components/game/TeacherAccessCodes.tsx');
const sessions=read('components/game/SessionManager.tsx');
const participants=read('components/game/TeacherParticipants.tsx');
const teacher=read('components/game/TeacherView.tsx');
const login=read('app/page.tsx');
for(const name of ['private.game_member_access','private.is_game_member',
 'private.can_game_member_action','private.guard_game_member_action',
 'teacher_member_access_list','teacher_set_member_access',
 'create_observer_invite','teacher_access_code_list',
 'teacher_revoke_access_code','teacher_delete_access_code',
 'join_game_with_code'])assert.ok(sql.includes(name),'SQL contract missing '+name);
for(const table of ['chat_messages','political_posts','formal_documents','game_ballots','event_decisions']){
 assert.ok(sql.includes('on public.'+table),'No DML enforcement for '+table);
}
assert.ok(sql.includes("and kind in ('student','observer') and active=false"),'Deletion must affect only revoked participant/guest invitations');
assert.ok(sql.includes("and (a.mode='removed'")&&sql.includes("a.mode='blocked'"),'Removed and banned participants must not rejoin');
assert.ok(sql.includes('alter table private.game_member_access enable row level security')&&
 sql.includes('revoke all on private.game_member_access'),'Private moderation ledger must have RLS and no direct grants');
assert.ok(sql.includes("if v_kind='teacher'")&&sql.includes('private.is_game_teacher(p_game_id)'),'Cannot moderate other teachers');
assert.ok(!/delete from public\.(game_members|game_profiles|games|stage_assessments)/i.test(sql),'Moderation must preserve game data');
for(const rpc of ['teacher_create_access_code','teacher_update_game_code','teacher_access_code_list','teacher_revoke_access_code','teacher_delete_access_code','create_observer_invite']){
 assert.ok(code.includes(rpc),'Unified access UI missing '+rpc);
}
assert.ok(code.includes("scope==='guest'")&&code.includes("generateCode(scope==='group'"),'Guest and group generation must be available');
assert.ok(!sessions.includes('profileGuestInvites'),'Legacy guest form must not duplicate the unified panel');
assert.ok(sessions.includes('<TeacherAccessCodes'),'Unified access panel is still mounted');
for(const rpc of ['teacher_member_access_list','teacher_set_member_access'])assert.ok(participants.includes(rpc),'Participant UI missing '+rpc);
for(const action of ['chat','posts','documents','votes','cases'])assert.ok(participants.includes("value:'"+action+"'"),'Restriction missing: '+action);
assert.ok(teacher.includes('<TeacherParticipants g={g}/>')&&teacher.includes("key:'participants'"),'Teacher workspace must contain roster');
assert.ok(login.includes('Приглашение гостя')&&login.includes('Приглашение участника')&&login.includes('личный пароль'),'Login labels differ from access management');
console.log('PASS unified invitations and reversible server-enforced moderation contracts');
