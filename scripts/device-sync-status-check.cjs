const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const source=fs.readFileSync('lib/localGameSnapshot.ts','utf8');
const component=fs.readFileSync('components/game/DeviceSyncStatus.tsx','utf8');
const client=fs.readFileSync('components/GameClient.tsx','utf8');
const profile=fs.readFileSync('components/game/ProfileView.tsx','utf8');
const layout=fs.readFileSync('app/layout.tsx','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const css=fs.readFileSync('app/device-sync-status.css','utf8');
for(const [name,data] of [['cache.ts',source],['component.tsx',component],['client.tsx',client],['game.ts',hook]]){
 const ast=ts.createSourceFile(name,data,ts.ScriptTarget.Latest,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.equal(ast.parseDiagnostics.length,0,'TypeScript parse '+name);
}
assert(!client.includes('DeviceSyncStatus'),'Sync button must be absent from the game header');
assert(profile.includes('{own&&game&&<section className="surface profileDeviceTools" aria-label="Данные на устройстве"><DeviceSyncStatus gameId={game.id} userId={me.user_id} realtimeState={g.realtimeState}/></section>}'),'Sync button only appears in the final section of the owner profile');
const controls=profile.slice(profile.indexOf('<div className="profileHeroControls">'),profile.indexOf('</div>',profile.indexOf('<div className="profileHeroControls">')));
assert(!controls.includes('<DeviceSyncStatus'),'Header must not contain device status');
assert(profile.indexOf('profileDeviceTools')>profile.indexOf('<TeacherGameSessions'),'Device status must follow the teacher sessions section');
assert(profile.indexOf('profileDeviceTools')>profile.indexOf('<BlitzArchive'),'Device status must follow student archive');
assert(!component.includes('clearRequestDiagnostics();window.removeEventListener'),'Leaving profile must preserve local diagnostic history');
assert(layout.includes("shortcut:'/favicon.ico?v=20261028-1'"),'Versioned browser favicon required');
assert(component.includes("detail.userId!==userId")&&component.includes("detail?.gameId!==gameId"),'Ignore cached events from a different account');
assert(component.includes("if(!live||wasUpdated)return"),'Old IndexedDB reads must never overwrite new state');
assert(hook.includes('readEpoch.current')&&hook.includes('acceptedMember.current?.user_id!==uid'),'Reject old session during device save');
assert(hook.includes('},1500)'), 'Reprioritize rapid pushed updates into one local write');
assert(css.includes('@media(max-width:760px)')&&css.includes('.profilePage .profileDeviceTools>.deviceSyncStatus'),'Button must stay inside mobile profile footer');
assert(!css.includes('.simTop'),'No toolbar placement CSS must remain');
assert(css.includes('width:min(100%,560px);max-width:100%')&&css.includes('position:static')&&!css.includes('position:absolute'),'Details expand inline and fit narrow screens');
const favicon=fs.readFileSync('app/favicon.ico');
assert.equal(favicon.readUInt16LE(0),0,'ICO header reserved');
assert.equal(favicon.readUInt16LE(2),1,'ICO format');
assert(favicon.readUInt16LE(4)>=3,'Browser icon should contain multiple dimensions');
assert(source.includes('tx.oncomplete=()=>finish(value)'),'Wait for durable IndexedDB transaction');

(async()=>{
 let now=2000000;const events=[],records=new Map();let initialized=false;
 const indexedDB={open(){
  const req={result:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
  queueMicrotask(()=>{
   req.result=database;
   if(!initialized){initialized=true;req.onupgradeneeded?.();}
   req.onsuccess?.();
  });return req;
 }};
 const database={
  objectStoreNames:{contains:()=>initialized&&created},
  createObjectStore(){created=true},
  close(){},
  transaction(){
   const tx={oncomplete:null,onabort:null,onerror:null};
   tx.objectStore=()=>({
    put(value,key){return operate(()=>{records.set(key,value);return key})},
    get(key){return operate(()=>records.get(key))},
    delete(key){return operate(()=>{records.delete(key);return undefined})}
   });
   function operate(operation){
    const req={result:undefined,onsuccess:null,onerror:null};
    queueMicrotask(()=>{req.result=operation();req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.())});
    return req;
   }
   return tx;
  }
 };
 let created=false;
 const win={indexedDB,dispatchEvent:event=>{events.push({type:event.type,...event.detail})}};
 const exports={};
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{exports,window:win,indexedDB,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},Date:class extends Date{static now(){return now}},console});
 const key='game-a',uid='user-1',other='user-2';
 const data={stages:[{id:'stage-1',game_id:key,stage_no:1,title:'Этап',status:'open',summary:'Опубликовано'}],
  metrics:[{id:'visible',game_id:key,is_public:true,value:4},{id:'private',game_id:key,is_public:false,value:99}],
  events:[{id:'event',game_id:key,published_at:'2026-10-27',title:'Опубликовано'},{id:'hidden',game_id:key,published_at:null,title:'Закрыто'}]};
 await exports.writeLocalGameSnapshot(key,uid,data);
 assert.equal(events[0].status,'saving');
 assert.equal(events[1].status,'saved','Saved only after IndexedDB commit');
 assert.equal(events[1].info.stages,1);
 assert.equal(events[1].info.metrics,1,'Private metrics excluded');
 assert.equal(events[1].info.events,1,'Unpublished events excluded');
 assert.equal((await exports.readLocalGameSnapshot(key,uid)).metrics[0].id,'visible');
 assert.equal(await exports.getLocalGameSnapshotInfo(key,other),null,'User B cannot read user A cache');
 assert.equal(await exports.getLocalGameSnapshotInfo('game-b',uid),null,'Other game is isolated');
 now+=120001;
 assert.equal(await exports.readLocalGameSnapshot(key,uid),null,'Expired state cannot authorize stale game actions');
 now-=120001;
 await exports.deleteLocalGameSnapshot(key,uid);
 assert.equal(await exports.getLocalGameSnapshotInfo(key,uid),null,'Logout deletes account cache');
 console.log('PASS device cache: commit, events, no secrets, account/game separation, TTL, logout');
})().catch(e=>{console.error(e);process.exitCode=1});
