const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const teacher=read('components/game/TeacherView.tsx');
const ghost=read('components/game/TeacherGhostVotingPanel.tsx');
const events=read('components/game/EventWorkspace.tsx');
const roster=read('components/game/TeacherParticipantRoster.tsx');
const css=read('app/design-shell.css')+'\n'+read('app/teacher-ui-polish.css');
assert(teacher.includes("title:'События'"));
assert(teacher.includes('Случайное теневое голосование'));
assert(!teacher.includes("title:'Event'")&&!teacher.includes('Ghost Voting')&&!teacher.includes('снять GV'));
assert(ghost.includes('Настройка теневого голосования')&&!ghost.includes('Ghost Voting'));
assert(events.includes('aria-label="События — ситуационные решения"'));
assert(!roster.includes('style={{'),'Use reusable responsive layout classes, not inline geometry');
for(const key of ['teacherParticipantRoster','teacherRosterHead','teacherRosterToolbar','teacherRosterList','teacherRosterEntry','teacherRosterActions','teacherRosterDialog','teacherRosterDialogActions']){
 assert(roster.includes(key),'Missing roster markup: '+key);
 assert(css.includes('.'+key),'Missing roster style: '+key);
}
assert(css.includes('@container (max-width:650px)'),'Invitations must stack in narrow containers');
assert(!roster.includes('Auth-аккаунт')&&!roster.includes('учётную запись Auth'));
console.log('PASS: Russian teacher actions and scoped responsive participant/access panels');
