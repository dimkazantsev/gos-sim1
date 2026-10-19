const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const read=path=>fs.readFileSync(path,'utf8');
const nameSource=read('components/game/cecNameDeclension.ts');
const compiled=ts.transpileModule(nameSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleContext={exports:{}};
vm.runInNewContext(compiled,moduleContext,{filename:'cecNameDeclension.js'});
const {cecAccusativeFullName,cecRegistrationDirective}=moduleContext.exports;
const cases=[
 ['Иванов Иван Иванович','Иванова Ивана Ивановича'],
 ['Казанцев Дмитрий Анатольевич','Казанцева Дмитрия Анатольевича'],
 ['Петрова Анна Сергеевна','Петрову Анну Сергеевну'],
 ['Иванова Мария Ивановна','Иванову Марию Ивановну'],
 ['Сидоренко Алексей Павлович','Сидоренко Алексея Павловича'],
 ['Кузнецкий Павел Львович','Кузнецкого Павла Львовича'],
 ['Шевченко Ольга Ивановна','Шевченко Ольгу Ивановну'],
 ['Петров Игорь Игоревич','Петрова Игоря Игоревича'],
 ['Смирнов Николай Ильич','Смирнова Николая Ильича']
];
for(const [input,expected] of cases){
 assert.equal(cecAccusativeFullName(input),expected,input);
 assert.equal(cecRegistrationDirective(input),'Зарегистрировать '+expected+' кандидатом на должность Президента Российской Федерации.');
}
assert.equal(cecAccusativeFullName('Неизвестное имя'),null);
assert.match(cecRegistrationDirective('Неизвестное имя'),/Зарегистрировать кандидата на должность/);
const form=read('components/game/CecOfficialDocument.tsx');
const lab=read('components/game/PresidentialElectionLab.tsx');
const policy=read('supabase/migrations/20261019235930_cec_chair_signature_issued_forms_read.sql');
const wording=read('components/game/cecOfficialWording.ts');
assert(form.includes('cecRegistrationDirective(candidate.display_name)'),'Final document uses accusative name');
assert(form.includes('ПОСТАНОВЛЯЕТ:'),'Official decision uses correct resolution label');
assert(form.includes("supabase.from('game_profiles').select('signature_path')"),'Chair signature resolved from game profile');
assert(form.includes("supabase.storage.from('game-assets').createSignedUrl(path,3600)"),'Photo resolved through signed storage access');
assert(form.includes('disabled={loadingSignature||!signature||!imageLoaded}'),'Printing waits for real signature');
assert(form.includes('chairUserId'),'Signed user is explicit');
assert(lab.includes("m.full_name?.trim()==='Казанцев Дмитрий Анатольевич'"),'Certificate selects actual CEC chair');
assert(lab.includes('chairProfile?.signature_url'),'Fallback signature belongs to chair');
assert(!/institutionEmblem\('minjust'\)|PartyCertificate|partyOfficialCertificate/.test(form),'CEC credentials never load a Minjust signature');
assert(policy.includes("FOR SELECT TO authenticated")&&policy.includes("name ~ '^[0-9a-fA-F-]+/profiles/"));
assert(policy.includes("gm.full_name='Казанцев Дмитрий Анатольевич'"),'Policy only covers CEC chair');
assert(policy.includes('private.is_game_member(p.game_id)'),'No public access to private signature');
assert(policy.includes("d.decision_type='registered'"),'Policy requires issued decision');
assert(wording.includes('Зарегистрирован кандидат'),'Candidate cards retain past-tense registration');
console.log('PASS: 9 Russian name declensions, safe fallback, authentic CEC-chair signature, scoped RLS, no blank printing.');
