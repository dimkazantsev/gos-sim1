/* ГОС.ID: Party chair election priority and Ministry of Justice letter templates. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const path='components/game/partyJusticeLetter.ts';
const mod=new Module(path,module);mod.filename=path;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,path);
const {buildPartyJusticeLetter,PARTY_REQUIRED_DOCS}=mod.exports;
const p={name:'Общественная инициатива',registration_submitted_at:'2026-10-12T12:00:00Z'};
const docs=PARTY_REQUIRED_DOCS.map((x,i)=>({id:'doc'+i,doc_kind:x.kind,title:x.name,status:'accepted',note:null}));
const positive=buildPartyJusticeLetter(p,docs,'Петров Пётр Иванович','registered');
const negative=buildPartyJusticeLetter(p,docs,'Петров Пётр Иванович','rejected');
assert.match(positive,/МИНИСТЕРСТВО ЮСТИЦИИ РОССИЙСКОЙ ФЕДЕРАЦИИ/);
assert.match(positive,/Департамент по делам некоммерческих организаций/);
assert.match(positive,/95-ФЗ/);
assert.match(positive,/политической партии «Общественная инициатива»/);
assert.match(positive,/Петров Пётр Иванович/);
assert.match(positive,/принято решение о государственной регистрации/);
assert(!positive.includes('[Укажите'),'Complete accepted documents should yield a usable positive draft');
assert.match(negative,/Основания отказа: \[Укажите/,'Refusal requires teacher-verified legal grounds');
assert.match(negative,/положениями Федерального закона № 95-ФЗ/);
const newestRevision={...docs[0],id:'application-v2',version_no:2,status:'revision',note:'Исправить подпись',created_at:'2026-10-14'};
const stale=buildPartyJusticeLetter(p,[...docs,newestRevision],undefined,'registered');
assert.match(stale,/не может быть подписан/,'Approved V1 cannot authorize registration after V2 revision');
assert.match(stale,/В2/,'Official Minjust letter displays latest version number');
const missing=buildPartyJusticeLetter(p,docs.slice(1),undefined,'registered');
assert.match(missing,/не может быть подписан/,'Never approve incomplete document package');
const noted=buildPartyJusticeLetter(p,[...docs.slice(0,1),{...docs[1],status:'revision',note:'Неполный порядок избрания руководящих органов'},...docs.slice(2)],undefined,'rejected');
assert.match(noted,/Неполный порядок избрания руководящих органов/);
assert.match(noted,/правовую достаточность необходимо подтвердить/);
for(const text of [positive,negative]){
 assert(!/\\d{7,}\\s*№/.test(text),'Do not reuse sample outgoing reference numbers');
 assert(!/Исх\\.\\s*№\\s*\\d/.test(text),'Do not invent an outgoing number in a draft');
}
const dossier=fs.readFileSync('components/game/TeacherPartyDossiers.tsx','utf8');
const fallback=fs.readFileSync('components/game/PartyChairFallback.tsx','utf8');
const review=fs.readFileSync('components/game/PartyJusticeReview.tsx','utf8');
const profile=fs.readFileSync('components/game/ProfileView.tsx','utf8');
const election=fs.readFileSync('components/game/PartyChairElection.tsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261014072000_stage_one_party_consent_and_gate.sql','utf8');
assert(!dossier.includes('<PartyMandateEditor'),'Party mandate editor must not be shown in teacher stage-one dossiers');
assert(dossier.includes('<PartyChairFallback'),'Emergency chair reassignment must remain available');
assert(fallback.includes('if(!g.teacher)return null'),'Only a teacher can see the fallback');
assert(fallback.includes("m.team===party.name"),'Teacher selects existing members of the party');
assert(fallback.includes('window.confirm'),'Emergency override requires explicit confirmation');
assert(sql.includes('if v_tied=1 then')&&sql.includes('leader_user_id=v_winner'),'Vote determines the chair on the server');
assert(profile.includes('partyChairTitle')&&profile.includes('chairedParty'),'Party chair visible in personal and public profile');
assert(election.includes('votedWinner'),'Election distinguishes elected from manually assigned leaders');
assert(review.includes("draft('registered')")&&review.includes("draft('rejected')"),'Two auto draft options exist');
assert(review.includes("decision==='registered'&&!ready"),'Incomplete registration stays blocked');
assert(review.includes("note.includes('[Укажите')"),'Unverified rejection grounds prevent sending');
assert(review.includes('g.reviewPartyRegistration('),'Official responses still require signing action');
console.log('PASS: voting priority, teacher fallback, profile chair status, Minjust positive/negative templates, document guards and manual signing.');
