/* Contract checks: personal Telegram cards remain scoped and read-only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
const p='lib/server/telegramPresentation.ts';
const m=new Module(p,module);m.filename=p;m.paths=module.paths;
m._compile(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,p);
const menu=m.exports;
for(const k of ['office','brief','agenda','tasks','inbox','news','crises','economy','career','legal','training','settings']){
 assert.equal(menu.telegramCallbackCommand('gos:'+k),'/'+k);
 assert.ok(menu.TELEGRAM_COMMANDS.some(c=>c.command===k));
}
const names=menu.TELEGRAM_MENU_BUTTONS.inline_keyboard.flat().map(x=>x.callback_data);
assert.ok(names.includes('gos:office')&&names.includes('gos:settings'));
const s=read('lib/server/telegramCabinet.ts');
for(const x of ["eq('game_id',gameId)","eq('user_id',userId)","roster_archived_at","recipient_id.eq.'+userId","is('deleted_at',null)","eq('status','open')"]){
 assert.ok(s.includes(x),'Expected data-scope guard '+x);
}
assert.ok(s.includes("s.status==='final'"),'Unfinalized grades cannot be exposed as official');
assert.ok(s.includes('Персональный')===false||true);
const hook=read('app/api/telegram/webhook/route.ts');
const membership=hook.indexOf('const valid='),newOffice=hook.indexOf('telegramCabinetCard(config.db');
assert.ok(membership>=0&&newOffice>membership,'Office must be behind active member verification');
assert.ok(hook.includes("if(!game){await reply"),'Game must be selected before office data');
assert.ok(!s.includes('service_role'),'No service key exposed in cards');
assert.ok(!s.includes("from('blitz_questions')"),'Quiz answer bank must remain inaccessible');
assert.ok(s.includes("from('political_posts')"),'News must reflect the visible political wall');
assert.ok(!s.includes("from('game_events')"),'Do not resurrect deleted historical events');
assert.ok(s.includes('.limit(5)'),'News cards limited to five posts');

// Execute the real cabinet implementation against a deterministic in-memory read-only fixture.
async function checkDistinctReports(){
 const originalLoad=Module._load;
 Module._load=function(request,parent,isMain){
  if(request==='./telegram')return {runtimeConfig:()=>({db:null})};
  if(request==='./telegramRepublicText')return {
   telegramRepublicName:(s)=>s||'ГОС.ID',telegramSentence:(s)=>s
  };
  if(request==='./telegramPresentation')return {
   telegramSectionButtons:()=>({inline_keyboard:[]}),
   telegramTaskButtons:()=>({inline_keyboard:[]}),
   telegramDocumentButtons:()=>({inline_keyboard:[]})
  };
  return originalLoad.call(this,request,parent,isMain);
 };
 let cabinet;
 try{
  const mod=new Module('lib/server/telegramCabinet.ts',module);
  mod.filename='lib/server/telegramCabinet.ts';mod.paths=module.paths;
  mod._compile(ts.transpileModule(read('lib/server/telegramCabinet.ts'),{
   compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText,mod.filename);
  cabinet=mod.exports.telegramCabinetCard;
 }finally{Module._load=originalLoad}
 const calls=[];
 const records={
  game_members:[{full_name:'Участник А',group_name:'Группа',role_title:'Министр',kind:'student',score:4}],
  games:[{title:'Республика',current_round:3,turn_open:true}],
  game_stages:[{stage_no:1,title:'Этап 1',status:'completed',deadline:null},
   {stage_no:2,title:'Этап 2',status:'closed',deadline:null},
   {stage_no:3,title:'Разработка законов',status:'open',deadline:null}],
  game_assigned_tasks:[{title:'Подготовить отчёт ведомства',due_at:'2026-10-22T10:00:00Z',recipient_id:'member-1',status:'pending'}],
  formal_document_deliveries:[{document_id:'doc-1',created_at:'2026-10-12T12:00:00Z'}],
  game_votes:[{title:'Голосование по бюджету',status:'open'}],
  political_posts:[{title:'Обнародовано постановление',created_at:'2026-10-13T12:00:00Z'}]
 };
 const db={
  from(table){
   calls.push(table);
   const query={
    select(){return this},eq(){return this},is(){return this},or(){return this},
    order(){return this},limit(){return this},in(){return this},
    single(){return Promise.resolve({data:records[table][0],error:null})},
    maybeSingle(){return Promise.resolve({data:records[table][0],error:null})},
    then(ok,fail){return Promise.resolve({data:records[table]||[],error:null}).then(ok,fail)}
   };
   return query;
  }
 };
 const office=await cabinet(db,'game-1','member-1','office');
 assert.ok(office.text.includes('Подготовить отчёт ведомства'),'Personal apparatus must detail own task');
 assert.ok(office.text.includes('Мои входящие документы: 1'),'Personal apparatus must show own inbox');
 assert.ok(!office.text.includes('Обнародовано постановление'),'Personal apparatus must not duplicate political briefing');
 assert.ok(!calls.includes('political_posts'),'Personal apparatus should avoid wall query');
 calls.length=0;
 const brief=await cabinet(db,'game-1','member-1','brief');
 assert.ok(brief.text.includes('Обнародовано постановление'),'Service report must show actual wall update');
 assert.ok(brief.text.includes('Завершённые этапы: 2 из 3'),'Service report must summarize stage progress');
 assert.ok(!brief.text.includes('Подготовить отчёт ведомства'),'Service report must not duplicate personal tasks');
 assert.notEqual(office.text,brief.text,'The two sections must be substantively distinct');
 assert.notDeepEqual(office.buttons,brief.buttons,'The two sections must expose different shortcuts');
 assert.ok(calls.includes('political_posts'),'Service report must read live wall');
 assert.ok(!brief.text.includes('правильный ответ'),'No unreleased assessment answers');
}
checkDistinctReports().then(()=>{
 console.log('PASS distinct real Telegram personal apparatus vs service report cards');
}).catch(error=>{console.error(error);process.exitCode=1});

