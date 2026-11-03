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
for(const essential of ['DashboardView','ProfileView','ChatPanel','StageComics'])
 assert(source.includes("import "+essential+" from './game/"+essential+"';"),
  essential+' must remain immediately available at login/onboarding');
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
function compile(node,env){
 const script=ts.transpileModule('module.exports='+node.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
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
 const presence=effects.find(n=>n.arguments[0].getText(ast).includes('const labels:Record<View,string>'));
 assert(presence,'The real presence effect is available');
 for(let n=0;n<40;n++){
  let tick,first,delay,initialDelay,now=1000,cleared=false,firstCleared=false;
  const calls=[],listeners=new Map();
  const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const {fn}=compile(presence.arguments[0],{
   me:{kind:'student',user_id:'student-'+n},g:{coreLoaded:true},gameId:'classroom',previewMode:false,view:'documents',
   document,Date:{now:()=>now},Math,firstPresenceWriteDelay:()=>2000,
   initialSqlPresence:{current:{scope:'',readyAt:0}},
   touchPresence:(...args)=>{calls.push(args);return Promise.resolve()},
   setTimeout:(fn,ms)=>{first=fn;initialDelay=ms;return 2},
   clearTimeout:()=>{firstCleared=true},
   setInterval:(fn,ms)=>{tick=fn;delay=ms;return 1},
   clearInterval:()=>{cleared=true}
  });
  const cleanup=fn();
  assert.equal(initialDelay,2000,'Optional SQL presence is delayed after entry');
  assert.equal(calls.length,0,'No immediate database write during a 100-client login burst');
  assert(delay>=60000&&delay<72000);
  now+=initialDelay;first();assert.equal(calls.length,1,'First SQL write is preserved once admitted');
  tick();assert.equal(calls.length,2);document.visibilityState='hidden';
  for(let minute=0;minute<20;minute++)tick();assert.equal(calls.length,2,'Hidden sessions send zero twenty-minute presence writes');
  document.visibilityState='visible';listeners.get('visibilitychange')();assert.equal(calls.length,3,'Returning starts a new presence interval');
  cleanup();assert(cleared&&firstCleared);assert.equal(listeners.size,0);
 }
 console.log('PASS: 40 game shells share counter delivery, preserve pending-case deduplication and role scope, suppress stale responses and hidden-tab presence writes');
}
main().catch(error=>{console.error(error);process.exitCode=1});
