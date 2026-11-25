const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {currentGameMembers,currentGameProfiles,REPUBLIC_LEADERSHIP,republicOfficeHolders}=require('../components/game/gameRoster');
const member=(id,role,extra={})=>({game_id:'classroom',user_id:id,full_name:'Иванов Иван',kind:'student',role_title:role,...extra});
const rows=[member('president','Президент Российской Федерации'),member('chair','Председатель ГД'),member('premier','Министр финансов'),member('namesake','Депутат'),member('archived','Президент',{roster_archived_at:'2026-10-02'}),member('foreign','Президент',{game_id:'another-class'}),member('candidate','Кандидат в Президенты'),member('president','Президент Российской Федерации')];
const roster=currentGameMembers(rows,'classroom');
assert.deepEqual(roster.map(m=>m.user_id),['president','chair','premier','namesake','candidate']);
assert.equal(roster.filter(m=>m.full_name==='Иванов Иван').length,5,'Different students with the same name remain visible');
assert.deepEqual(currentGameProfiles([{game_id:'classroom',user_id:'president'},{game_id:'another-class',user_id:'president'},{game_id:'classroom',user_id:'archived'},{game_id:'classroom',user_id:'not-a-member'}],rows,'classroom'),[{game_id:'classroom',user_id:'president'}]);
const [president,chair,premier]=REPUBLIC_LEADERSHIP;
const office=(user,status,role,game='classroom')=>({game_id:game,user_id:user,status,role_title:role});
assert.deepEqual(republicOfficeHolders(rows,[],'classroom',president.role).map(m=>m.user_id),['president']);
assert.deepEqual(republicOfficeHolders(rows,[],'classroom',chair.role).map(m=>m.user_id),['chair']);
assert.equal(republicOfficeHolders(rows,[office('premier','pending','Председатель Правительства РФ')],'classroom',premier.role).length,0);
assert.equal(republicOfficeHolders(rows,[office('premier','active','Председатель Правительства РФ','another-class')],'classroom',premier.role).length,0);
assert.deepEqual(republicOfficeHolders(rows,[office('premier','active','Председатель Правительства Российской Федерации')],'classroom',premier.role).map(m=>m.user_id),['premier'],'Approved role remains visible during educational rotation');
assert.equal(republicOfficeHolders(rows,[office('president','ended','Президент Российской Федерации')],'classroom',president.role).length,0,'Ended office overrides an outdated legacy title');
assert.equal(republicOfficeHolders(rows,[office('archived','active','Президент Российской Федерации')],'classroom',president.role).length,1,'An archived member does not become an additional holder');
console.log('PASS classroom isolation, archived sign-ins, duplicate IDs, namesakes, profile links, three leadership offices, pending/active/ended assignments and educational rotation');


 // Compare with the original nested scans, including scope, archive and order.
 const syntheticMembers=Array.from({length:100},(_,i)=>member('u-'+i,i%7===0?'Президент':'Депутат',{kind:i%11===0?'observer':'student'}));
 syntheticMembers.push(member('archived-x','Президент',{roster_archived_at:'2026-10-02'}),member('foreign-x','Президент',{game_id:'another-class'}));
 const rawOffices=Array.from({length:200},(_,i)=>office('u-'+(i%100),['active','ended','pending'][i%3],['Президент','Председатель ГД','Председатель Правительства РФ'][i%3],i%13===0?'another-class':'classroom'));
 rawOffices.push(office('archived-x','active','Президент'),office('foreign-x','active','Президент'),office('absent','active','Президент'));
 const current=currentGameMembers(syntheticMembers,'classroom');
 const referenceAssignments=(offices,members,gameId)=>offices.filter(o=>o.game_id===gameId&&members.some(m=>m.user_id===o.user_id));
 const referenceHolders=(members,offices,gameId,role)=>currentGameMembers(members,gameId).filter(m=>{
  if(m.kind==='observer')return false;
  const assignments=offices.filter(o=>o.game_id===gameId&&o.user_id===m.user_id&&role.test(o.role_title.trim()));
  return assignments.length?assignments.some(o=>o.status==='active'):(m.role_title||'').split(' · ').some(title=>role.test(title.trim()));
 });
 const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
 const line=hook.split('\n').find(s=>s.startsWith(' const officeAssignments=useMemo('));
 assert(line,'Actual office assignment computation must be discoverable');
 const actualAssignments=new Function('useMemo','officeRows','members','gameId',line+';return officeAssignments;');
 const assign=(offices,members,gameId)=>actualAssignments(fn=>fn(),offices,members,gameId);
 let memberReads=0,officeReads=0;
 const measuredMembers=current.map(m=>({...m,get user_id(){memberReads++;return m.user_id}}));
 const measuredOffices=rawOffices.map(o=>({...o,get game_id(){officeReads++;return o.game_id}}));
 const expectedAssignments=referenceAssignments(rawOffices,current,'classroom');
 assert.deepEqual(assign(rawOffices,current,'classroom'),expectedAssignments);
 assert.deepEqual(assign([],current,'classroom'),[]);
 assert.deepEqual(assign(rawOffices,[],'classroom'),[]);
 assert.deepEqual(assign(rawOffices,current,'another-class'),referenceAssignments(rawOffices,current,'another-class'));
 assign(rawOffices,measuredMembers,'classroom');
 assert(memberReads<=100,'Office scope must read each roster identifier at most once: '+memberReads);
 for(const body of REPUBLIC_LEADERSHIP){
  assert.deepEqual(republicOfficeHolders(syntheticMembers,rawOffices,'classroom',body.role),referenceHolders(syntheticMembers,rawOffices,'classroom',body.role));
  republicOfficeHolders(syntheticMembers,measuredOffices,'classroom',body.role);
 }
 assert(officeReads<=rawOffices.length*3,'Leadership office scan must be linear per body: '+officeReads);
 console.log(JSON.stringify({memberReads,officeReads,officeRows:rawOffices.length,scope:'synthetic roster, no network'}));
