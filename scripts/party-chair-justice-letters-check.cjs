/* ГОС.ID: Party chair election priority and Ministry of Justice letter templates. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
require.extensions['.ts']=(tsModule,filename)=>tsModule._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,filename);
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
const {formalSignerOffice}=require('../components/game/formalInstitutions.ts');
const signedMinjust={subject_key:'minjust',doc_type:'justice_response',metadata:{}};
const knownOffice='Директор Департамента по делам некоммерческих организаций Министерства юстиции Российской Федерации';
assert.equal(formalSignerOffice(signedMinjust,'Преподаватель'),knownOffice,'Teacher signs Minjust responses as the relevant official, not their access role');
assert.equal(formalSignerOffice({...signedMinjust,doc_type:'party_certificate',metadata:{signatory_title:knownOffice}},'Преподаватель'),knownOffice,'Certificates honor their approved signatory title');
assert.equal(formalSignerOffice({subject_key:'sf',doc_type:'sf_resolution',metadata:{}},'Преподаватель'),'Председатель Совета Федерации','Different issuing institutions imply different signature offices');
assert.equal(formalSignerOffice({subject_key:'government',doc_type:'government_resolution',metadata:{acting_office_title:'Заместитель Председателя Правительства Российской Федерации'}},'Преподаватель'),'Заместитель Председателя Правительства Российской Федерации','Recorded acting office takes precedence');
assert.equal(formalSignerOffice(signedMinjust,'Министр юстиции Российской Федерации'),'Министр юстиции Российской Федерации','Do not override an already recorded real office');
assert.equal(formalSignerOffice({subject_key:'unknown',doc_type:'other',metadata:{}},'Преподаватель'),'Уполномоченное лицо','Do not invent an unsupported office');
const paperSource=fs.readFileSync('components/game/DocumentPaper.tsx','utf8');
assert(paperSource.includes('role=formalSignerOffice(d,metadataSigned?m.signed_role:null)'), 'All official paper signatures must resolve technical roles using document context');
console.log('PASS: voting priority, teacher fallback, profile chair status, Minjust positive/negative templates, document guards and manual signing.');
