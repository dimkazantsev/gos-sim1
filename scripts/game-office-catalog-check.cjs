'use strict';
// Regression of the author's sixteen-stage role model (five government portfolios).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
const src=read('components/game/gameOfficeCatalog.ts');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context={exports:{}};
vm.runInNewContext(js,context);
const {gameOfficeGroups,gameOfficeRoleList}=context.exports;
const groups=gameOfficeGroups();
const all=gameOfficeRoleList(groups);
const ministries=groups.find(g=>g.label==='Пять министерств Правительства').roles;
const committees=groups.find(g=>g.label==='Пять комитетов Государственной Думы').roles;
assert.equal(ministries.filter(s=>s.startsWith('Министр ')).length,5,'Exactly five minister portfolios');
assert.equal(ministries.filter(s=>s.startsWith('Сотрудник — ')).length,5,'Five ministerial staffs');
assert.equal(committees.filter(s=>s.startsWith('Председатель комитета')).length,5,'Exactly five Duma committee chairs');
assert.equal(committees.filter(s=>s.startsWith('Член комитета')).length,5,'Five Duma committees');
assert.equal(groups.find(g=>g.label.includes('Барнаула')).roles.length,11,'Barnaul mayor and five district heads/staff');
assert.equal(all.length,new Set(all.map(x=>x.toLowerCase())).size,'No duplicate appointment labels');
for(const prohibited of ['Министр финансов','Министр экономики','Министр образования','Министр здравоохранения','Министр науки','Министр культуры','Министр транспорта','Министр труда','Министр энергетики','Министр цифрового развития','Министр иностранных дел','Министр внутренних дел','Министр чрезвычайных ситуаций','Министр природных ресурсов']){
 assert(!all.includes(prohibited),'Outside-game portfolio: '+prohibited);
}
for(const required of ['Член КСРФ','Президент Российской Федерации','Председатель Государственной Думы','Заместитель Председателя Государственной Думы','Депутат Государственной Думы','Сенатор Российской Федерации','Председатель Правительства Российской Федерации','Заместитель Председателя Правительства Российской Федерации','Председатель Банка России','Глава города Барнаула']){
 assert(all.includes(required),'Missing game role: '+required);
}
// The president may approve new *names* for exactly these five portfolios.
const approved=gameOfficeRoleList(gameOfficeGroups({status:'approved',social_title:'Министерство развития человека',economic_title:'Министерство экономики и инвестиций'},[
 {unit_kind:'ministry',unit_key:'social',title:'Старое название министерства'},
 {unit_kind:'committee',unit_key:'social',title:'Комитет по развитию человека'}
]));
assert(approved.includes('Министр развития человека'),'Approved social title overrides outdated unit');
assert(approved.includes('Министр экономики и инвестиций'),'Approved economic title used');
assert(!approved.includes('Министр по социальной политике'),'Stale title not displayed');
assert(approved.includes('Председатель комитета Государственной Думы по развитию человека'),'Committee title from game used');
assert.equal(approved.length,all.length,'Custom names cannot create extra portfolios');

const office=read('components/game/ProfileOffices.tsx');
const profile=read('components/game/ProfileView.tsx');
const hook=read('components/game/useGameOfficeCatalog.ts');
assert(office.includes('roleGroups.map(group=><optgroup'),'Grouped select includes every role');
assert(office.includes('roleAllowed')&&office.includes('!catalogReady'),'Cannot appoint arbitrary strings or before catalogue loads');
assert(!office.includes('Другая должность…')&&!office.includes('Министр финансов'),'Remove freeform and fictional portfolios from appointment form');
assert(profile.includes('useGameOfficeCatalog')&&profile.includes('gameOfficeRoleList'),'Teacher role selector uses same verified list');
assert(!profile.includes('Министр финансов')&&!profile.includes('Другая игровая должность'),'No stale alternative list');
assert(hook.includes(".eq('game_id',gameId)")&&hook.includes(".limit(12)")&&!hook.includes("setInterval("),'Game-scoped, bounded and nonpolling');
console.log('PASS: 5 ministries, 5 Duma committees, approved renames, Barnaul positions, teacher/student catalogue, no invented ministry roles');
