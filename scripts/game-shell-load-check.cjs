const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const file='components/GameClient.tsx',source=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length,0);
// The game must not ship all inactive institution/workspace screens on login.
// Rendering a route on demand is the only supported trigger for its JS chunk.
const deferred=['PoliticalWallView','CrisisRoom','StagesView','PartiesView',
 'VotesView','DocumentsView','GradesView','TeacherView',
 'EventWorkspace','BudgetView'];
for(const screen of deferred){
 assert(source.includes("const "+screen+"=dynamic(()=>import('./game/"+screen+"'),{loading:sectionLoading});"),
  screen+' must be imported as a lazy, independently downloadable view');
 assert(!source.includes("import "+screen+" from './game/"+screen+"';"),
  screen+' must not be bundled eagerly by the game shell');
}
for(const essential of ['DashboardView','ProfileView','StageComics'])
 assert(source.includes("import "+essential+" from './game/"+essential+"';"),
  essential+' must remain immediately available at login/onboarding');
// The emergency chat pause must not download ChatPanel for every student.
// When chat is restored, it may continue to load only when the chat opens.
const chatPaused=/export const CHAT_PAUSED\\s*=\\s*true/.test(fs.readFileSync('lib/featureFreeze.ts','utf8'));
const eagerChat=source.includes("import ChatPanel from './game/ChatPanel';");
const lazyChat=source.includes("const ChatPanel=dynamic(()=>import('./game/ChatPanel'),{loading:sectionLoading});");
assert(eagerChat||lazyChat,'ChatPanel must remain accessible after resumption');
if(chatPaused)assert(lazyChat&&!eagerChat,'Paused chat must not be bundled with the game shell');
assert(source.includes("import dynamic from 'next/dynamic';"),
 'Next.js must resolve each view to a separate lazy chunk');

const sync=[],effects=[];
function visit(node){
 if(ts.isCallExpression(node)){
  if(node.expression.getText(ast)==='useGameTableSync')sync.push(node);
  if(node.expression.getText(ast)==='useEffect')effects.push(node);
 }
 ts.forEachChild(node,visit);
}
visit(ast);
assert(!source.includes("supabase.channel('event-count:")&&!source.includes("supabase.channel('blitz-count:"),'Counters share the game socket instead of two additional channels per participant');

const eventSQL=fs.readFileSync('supabase/migrations/20261103165000_event_push_shared_game_channel.sql','utf8');
const eventHook=fs.readFileSync('components/game/useGameTableSync.ts','utf8');
const eventShell=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const eventWorkspace=fs.readFileSync('components/game/EventWorkspace.tsx','utf8');
const eventDiscussion=fs.readFileSync('components/game/EventCollaboration.tsx','utf8');
assert(eventSQL.includes('FOR EACH STATEMENT'),'Bulk assignments must be coalesced into one broadcast per statement');
assert(eventSQL.includes('GET DIAGNOSTICS n=ROW_COUNT'),'Audience assignment must use one set-based INSERT and preserve the actual inserted count');
assert(!eventSQL.includes("WHEN 'event_decisions' THEN ARRAY"),'Individual votes must not be broadcast to every classroom client');
assert(eventSQL.includes("'gos-id-live:'||v_item.game_id::text"),'Only the existing private game topic carries notifications');
assert(eventSQL.includes('v_cases')&&eventSQL.includes('case_id=ANY(v_cases)'),'Student feed must load only relevant cases');
assert(eventHook.includes('connectedReconcileMs=connectedFallbackMs??(eventOnly?900000:180000)'),'Idle events are reconciled sparsely over healthy realtime');
assert(eventShell.includes("event:'event_feed_changed'")&&eventShell.includes('targets.includes(me.user_id)'),'Only a targeted student should re-read assigned situations');
assert(eventShell.includes('const restored=everSubscribed&&!wasConnected'),'Reconnect causes one reconciliation but a cold join retains initial jitter');
assert(eventWorkspace.includes('notifyEventPendingCount(game.id,me.user_id,pending.size)'),'Visible event feed must supply the header counter without a second REST read');
assert(eventDiscussion.includes('60000,0,caseId'),'Only the expanded discussion case should refetch after its notice');

assert(source.includes("window.addEventListener('blitz:updated',changed)"),'A local blitz answer still invalidates the shared badge immediately');
assert(source.includes("g.me?.kind+':'+!!viewAs"),'Role changes invalidate the previous counter scope');
// The teacher preview must include a guest role, not reuse the student's write permissions.
assert(source.includes("const GENERIC_GUEST='__generic_guest_preview__'"),'Guest preview selection has its own identifier');
assert(source.includes("kind:'observer',role_title:'Гость'"),'Guest preview uses the observer role');
assert(source.includes('aria-checked={viewAs===GENERIC_GUEST}')&&source.includes('onClick={()=>selectViewAs(GENERIC_GUEST)}>Гость</button>'),
 'Teacher can select the guest role from the existing menu');
assert(source.includes("if(student.kind==='observer')return false;"),'Guest preview must never vote');
assert(source.includes("availableActors:()=>student.kind==='observer'?[]"),'Guest preview must never acquire publication actors');
assert(source.includes('readOnly={previewMode||observer||!!previewGuest}'),'Every teacher preview, including guest, must keep chat read-only');
assert(source.includes("previewGuest?'Режим гостя:':'Режим студента:'"),'Guest preview must be clearly labelled');
assert(source.includes('observer||previewGuest?\' observerShell\''),
 'Guest preview reuses the established guest styles');
function compile(node,env,syntax=ast){
 const script=ts.transpileModule('module.exports='+node.getText(syntax),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context={module:{exports:{}},...env};vm.runInNewContext(script,context);return {fn:context.module.exports,context};
}
function fixture(){
 const queries=[],events=[],blitz=[];
 const env={game:{id:'classroom'},me:{user_id:'student',kind:'student'},g:{coreLoaded:true},previewMode:false,counterScope:'scope',counterScopeRef:{current:'scope'},Set,
  setPendingEvents:n=>events.push(n),setPendingBlitz:n=>blitz.push(n)};
 env.supabase={from(table){
  const record={table,filters:{}};queries.push(record);
  const q={select(columns){record.columns=columns;return q},eq(key,value){record.filters[key]=value;return q},then(resolve,reject){
   return Promise.resolve({data:table==='event_assignments'?[{case_id:'one'},{case_id:'two'}]:[{case_id:'two'},{case_id:'three'}],error:null}).then(resolve,reject);
  }};return q;
 },rpc:async(name,args)=>{queries.push({rpc:name,args});return {data:name==='get_my_pending_event_count'?3:{pending:4},error:null}}};
 return {env,queries,events,blitz};
}
async function main(){
 const eventCall=sync.find(n=>n.arguments[1].getText(ast).includes('event_assignments'));
 const blitzCall=sync.find(n=>n.arguments[1].getText(ast).includes('blitz_assignments'));
 assert(eventCall&&blitzCall,'Both badge loaders use the existing shared scheduler');
 assert.equal(eventCall.arguments[6].getText(ast),'60000','Event badge refresh is limited to once per minute');
 for(let n=0;n<40;n++){
  const f=fixture();await compile(eventCall.arguments[2],f.env).fn();await compile(blitzCall.arguments[2],f.env).fn();
  assert.equal(f.queries.length,2,'One pending-event counter RPC plus one blitz RPC, not three network reads');
  assert.equal(f.queries[0].rpc,'get_my_pending_event_count');
  assert.equal(f.queries[0].args.p_game_id,'classroom');
  assert.deepEqual(f.events,[3],'Server count already deduplicates matching situation IDs');
  assert.deepEqual(f.blitz,[4]);
 }
 for(const previewMode of [true,false]){
  const f=fixture();f.env.previewMode=previewMode;f.env.me.kind='observer';
  await compile(blitzCall.arguments[2],f.env).fn();assert.equal(f.queries.length,0,'Observers and previews never request a student blitz counter');
 }
 const late=fixture();let resolve;
 late.env.supabase.rpc=()=>new Promise(r=>{resolve=r});
 const pending=compile(blitzCall.arguments[2],late.env).fn();
 late.env.counterScopeRef.current='new-game-or-user-or-role';resolve({data:{pending:99},error:null});await pending;
 assert.equal(late.blitz.length,0,'A response from the previous scope cannot populate the new badge');
 const hookFile='components/game/usePresenceHeartbeat.ts';
 const hookSource=fs.readFileSync(hookFile,'utf8');
 const hookAst=ts.createSourceFile(hookFile,hookSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 assert.equal(hookAst.parseDiagnostics.length,0);
 assert(source.includes('usePresenceHeartbeat({gameId,userId:me?.user_id,view,enabled:g.coreLoaded&&!previewMode,touchPresence})'),'The game shell wires the real presence hook');
 let presence;
 function walkPresence(node){if(ts.isCallExpression(node)&&node.expression.getText(hookAst)==='useEffect')presence=node;ts.forEachChild(node,walkPresence)}
 walkPresence(hookAst);
 assert(presence,'The real extracted presence effect is available');
 const schedulerModule={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/game/presenceHeartbeat.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:schedulerModule,exports:schedulerModule.exports});
 const schedulePresenceHeartbeat=schedulerModule.exports.schedulePresenceHeartbeat;
 for(let n=0;n<40;n++){
  let now=1000,nextId=0,callbacks=0;
  const calls=[],listeners=new Map(),timers=new Map();
  const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const userId='student-'+n,gameId='classroom',view='documents',enabled=true;
  const admission={current:{scope:'',readyAt:0}};
  const writer={current:{gameId,userId,view,enabled,touchPresence:(...args)=>{calls.push(args);return Promise.resolve()}}};
  const env={userId,gameId,view,enabled,document,admission,writer,labels:{documents:'НПА / Формальные институты'},Date:{now:()=>now},
   firstPresenceWriteDelay:()=>2000,schedulePresenceHeartbeat,
   setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{at:now+ms,fn});return id},clearTimeout:id=>timers.delete(id)};
  function advance(ms){const target=now+ms;while(timers.size){const [id,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(t.at>target)break;now=t.at;timers.delete(id);callbacks++;t.fn()}now=target}
  const cleanup=compile(presence.arguments[0],env,hookAst).fn();
  assert.equal(timers.size,1);assert.equal([...timers.values()][0].at-now,2000);
  assert.equal(calls.length,0,'No immediate write on login');
  advance(2000);assert.equal(calls.length,1);assert.deepEqual(calls[0],[view,'Открыл раздел «НПА / Формальные институты»']);
  const delay=[...timers.values()][0].at-now;assert(delay>=68000&&delay<74000);
  advance(delay);assert.equal(calls.length,2);assert.equal(calls[1][1],undefined);
  document.visibilityState='hidden';listeners.get('visibilitychange')();
  const before=callbacks;advance(1200000);
  assert.equal(callbacks,before,'No background timer wakeups');assert.equal(calls.length,2);assert.equal(timers.size,0);
  document.visibilityState='visible';listeners.get('visibilitychange')();assert.equal(calls.length,3);
  cleanup();assert.equal(timers.size,0);assert.equal(listeners.size,0);
 }
 console.log('PASS: 40 game shells share counter delivery, preserve pending-case deduplication and role scope, suppress stale responses and hidden-tab presence writes');
}
main().catch(error=>{console.error(error);process.exitCode=1});
