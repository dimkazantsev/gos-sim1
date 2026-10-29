/* Executes the actual client hook with deterministic simulated Supabase I/O.
 * No database, browser server, session credentials, or external writes are used. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const code=ts.transpileModule(fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}

function harness({effects=false,compiledCode=code}={}){
 const slots=[],pendingEffects=[],channels=[],timers=new Map(),listeners=new Map(),counts=new Map(),holds=new Map(),failures=new Set(),failureCodes=new Map();
 let cursor=0,dirty=false,revision=1,user='teacher-a',memberKind='teacher',gameId='game-a',authCallback,authError=null,clock=0,requests=0,disposed=false,recorders=0,stoppedTracks=0,withBallots=false,assetPaths=false,signed=0,activeSigns=0,peakSigns=0;
 let virtualNow=Date.parse('2026-10-26T00:00:00Z'),responseBytes=0,aborted=0,ignoreAbort=false;
 const started=new Map(),notices=[],docListeners=new Map(),fixtures=new Map(),queryLog=[],rpcFailures=new Map();
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[virtualNow]));}static now(){return virtualNow;}}
 const permission=deferred(),mediaSend=deferred();
 class Recorder{constructor(){recorders++;this.state='inactive';}static isTypeSupported(){return false;}start(){this.state='recording';}stop(){this.state='inactive';this.onstop?.();}}
 const redirects=[];
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;return(slots[i]??={value:{current:initial}}).value;},
  useMemo(fn){cursor++;return fn();},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((v,j)=>!Object.is(v,old.deps?.[j]))){slots[i]={deps,cleanup:old?.cleanup};if(effects)pendingEffects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}
 };
 const supabase={
  auth:{
   getSession:async()=>{requests++;if(authError)throw authError;return{data:{session:user?{user:{id:user}}:null},error:null};},
   onAuthStateChange(callback){authCallback=callback;return{data:{subscription:{unsubscribe(){if(authCallback===callback)authCallback=undefined;}}}};},
   signOut:async()=>{user=null;authCallback?.('SIGNED_OUT',null);return{error:null};}
  },
  channel(){const handlers=[];const channel={on(kind,filter,callback){handlers.push({filter,callback});return this;},subscribe(callback){callback?.('SUBSCRIBED');return this;},handlers};channels.push(channel);return channel;},
  removeChannel:async channel=>{const index=channels.indexOf(channel);if(index!==-1)channels.splice(index,1);},
  from(table){
   requests++;const number=(counts.get(table)||0)+1;counts.set(table,number);
   const snapshot={revision,user,gameId,memberKind},fixtureSnapshot=fixtures.has(table)?JSON.parse(JSON.stringify(fixtures.get(table))):null;
   const query={singleRow:false,eqs:{},ins:{},upsert(){started.set('write:'+table,(started.get('write:'+table)||0)+1);return Promise.resolve({data:null,error:null});},insert(){started.set('write:'+table,(started.get('write:'+table)||0)+1);return Promise.resolve({data:null,error:null});},select(){return this;},order(){return this;},limit(){return this;},eq(key,value){this.eqs[key]=value;return this;},single(){this.singleRow=true;return this;},maybeSingle(){this.singleRow=true;return this;},in(key,values){this.ins[key]=values;return this;},abortSignal(signal){this.signal=signal;signal.addEventListener('abort',()=>{aborted++},{once:true});return this;},
    async then(resolve,reject){try{
     started.set(table,(started.get(table)||0)+1);
     queryLog.push({table,eqs:{...this.eqs},ins:{...this.ins}});
     const wait=holds.get(table+':'+number)?.promise;
     if(wait&&this.signal&&!ignoreAbort)await Promise.race([wait,new Promise((_,fail)=>this.signal.addEventListener('abort',()=>fail(new Error('simulated abort')),{once:true}))]);
     else await wait;
     const id=this.eqs.game_id||snapshot.gameId;
     let data=[];
     if(table==='games')data={id:this.eqs.id||snapshot.gameId,current_round:snapshot.revision,title:'revision-'+snapshot.revision};
     if(table==='game_members'){const member={game_id:id,user_id:snapshot.user,full_name:snapshot.user,kind:snapshot.user==='teacher-a'?snapshot.memberKind:'student'};data=this.singleRow?member:[member];}
     if(table==='state_metrics')data=[{id:'metric',game_id:id,value:snapshot.revision}];
     if(withBallots&&table==='game_votes')data=[{id:'vote',game_id:id}];
     if(withBallots&&table==='game_ballots')data=[{id:'ballot-'+snapshot.revision,user_id:snapshot.user}];
     if(withBallots&&table==='game_evaluations')data=[{id:'evaluation-'+snapshot.revision,user_id:snapshot.user}];
     if(withBallots&&table==='game_crises')data=[{id:'crisis-'+snapshot.revision,game_id:id}];
     if(withBallots&&table==='game_documents')data=[{id:'document-'+snapshot.revision,game_id:id,created_by:snapshot.user}];
     if(table==='game_parties')data=[{id:'party-'+snapshot.revision,game_id:id,name:'party-'+snapshot.revision,...(assetPaths?{logo_path:id+'/parties/logo.png'}:{})}];
      if(table==='party_documents'&&assetPaths)data=Array.from({length:12},(_,i)=>({id:'doc-'+i,game_id:id,party_id:'party-1',doc_kind:'program',storage_path:id+'/docs/doc-'+i+'.pdf',created_at:'2026-10-16T00:00:00Z'}));
      if(table==='game_profiles'&&assetPaths)data=[{game_id:id,user_id:snapshot.user,avatar_path:'teacher-assets/'+snapshot.user+'/avatar-fixture.webp',signature_path:'teacher-assets/'+snapshot.user+'/signature-fixture.png'}];
     if(table==='political_posts')data=[{id:'post-'+snapshot.revision,game_id:id,title:'post-'+snapshot.revision}];
     if(table==='chat_channels')data=[{id:'channel-a',game_id:id,name:'Общий чат',kind:'public'}];
     if(table==='chat_messages')data=[{id:'message-'+snapshot.revision,game_id:id,channel_id:this.eqs.channel_id||'channel-a',text:'message-'+snapshot.revision,created_at:'2026-10-08T10:00:00Z'}];
     if(fixtureSnapshot){data=fixtureSnapshot.filter(row=>Object.entries(this.eqs).every(([key,value])=>row[key]===value)&&Object.entries(this.ins).every(([key,values])=>values.includes(row[key])));if(this.singleRow)data=data[0]||null;}
     const result=failures.has(table)?{data:null,error:{message:'simulated read outage '+table,code:failureCodes.get(table)}}:{data,error:null};
     responseBytes+=Buffer.byteLength(JSON.stringify(result));resolve(result);
    }catch(error){reject(error);}}
   };return query;
  },
  rpc:async(name,args)=>{
   requests++;
   started.set('rpc:'+name,(started.get('rpc:'+name)||0)+1);
   if(rpcFailures.has(name))return{data:null,error:{code:rpcFailures.get(name),message:'simulated RPC failure '+name}};
   if(name==='get_formal_registry_projection'){
    // The server-side snapshot is captured before a synthetic delayed response.
    // This lets recovery tests exercise stale responses and per-ID invalidation.
    const id=args.p_game_id,ids=args.p_document_ids;
    const read=table=>fixtures.has(table)
     ?JSON.parse(JSON.stringify(fixtures.get(table))).filter(row=>row.game_id===id&&
       (ids===null||ids===undefined||ids.includes(table==='formal_documents'?row.id:row.document_id)))
     :[];
    const documents=read('formal_documents').sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
    const history=read('formal_document_history').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    const number=(counts.get('formal_registry')||0)+1;counts.set('formal_registry',number);
    queryLog.push({table:'rpc:get_formal_registry_projection',eqs:{game_id:id},ins:{document_ids:ids}});
    await holds.get('formal_registry:'+number)?.promise;
    const broken=['formal_documents','formal_document_history'].find(table=>failures.has(table));
    if(broken)return{data:null,error:{message:'simulated read outage '+broken,code:failureCodes.get(broken)||'PGRST123'},status:400};
    return{data:{documents,history},error:null,status:200};
   }
   if(name==='get_chat_pins_projection'){
    // Model a bounded, joined RPC response so the 100-client test observes
    // exactly the transport used by the actual hook, not a legacy table read.
    const rows=fixtures.has('chat_pins')?JSON.parse(JSON.stringify(fixtures.get('chat_pins'))):[];
    const pins=rows.filter(row=>row.channel_id===args.p_channel_id)
     .sort((a,b)=>String(b.pinned_at).localeCompare(String(a.pinned_at))).slice(0,12);
    const ids=new Set(pins.map(row=>row.message_id));
    const allMessages=fixtures.has('chat_messages')?JSON.parse(JSON.stringify(fixtures.get('chat_messages')))
     :[{id:'message-'+revision,game_id:gameId,channel_id:args.p_channel_id,text:'message-'+revision,created_at:'2026-10-08T10:00:00Z'}];
    const messages=allMessages.filter(row=>row.channel_id===args.p_channel_id&&ids.has(row.id));
    return{data:{pins,messages},error:null,status:200};
   }
   if(name==='get_impact_engine_projection'){
    const id=args.p_game_id;
    const read=(table,defaultRows)=>fixtures.has(table)
     ?JSON.parse(JSON.stringify(fixtures.get(table))).filter(row=>row.game_id===id)
     :defaultRows;
    const broken=['impact_rules','impact_ledger'].find(table=>failures.has(table));
    if(broken)return{data:null,error:{message:'simulated read outage '+broken,code:failureCodes.get(broken)||'PGRST123'},status:400};
    return{data:{
     rules:read('impact_rules',[{id:'impact-rule',game_id:id,priority:1,enabled:true}]).sort((a,b)=>a.priority-b.priority),
     ledger:read('impact_ledger',[]).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,500)
    },error:null,status:200};
   }
   if(name==='get_political_wall_projection'){
    const snapshot={revision,user,gameId},id=args.p_game_id;
    const n=(counts.get('political_wall')||0)+1;counts.set('political_wall',n);
    await holds.get('political_wall:'+n)?.promise;
    // An entire PostgreSQL projection fails if one of its SELECTs fails.
    const broken=['political_posts','political_post_media','political_post_formal_links','state_metric_history','party_support_history','state_metrics'].find(table=>failures.has(table));
    if(broken)return{data:null,error:{message:'simulated read outage '+broken,code:failureCodes.get(broken)||'PGRST123'},status:400};
    const fixtureRows=(table,defaults)=>fixtures.has(table)
     ?JSON.parse(JSON.stringify(fixtures.get(table))).filter(row=>row.game_id===id)
     :defaults;
    return{data:{
     posts:fixtureRows('political_posts',[{id:'post-'+snapshot.revision,game_id:id,title:'post-'+snapshot.revision}]),
     media:fixtureRows('political_post_media',[]),
     formal_links:fixtureRows('political_post_formal_links',[]),
     metric_history:fixtureRows('state_metric_history',[]),
     support_history:fixtureRows('party_support_history',[]),
     metrics:fixtureRows('state_metrics',[{id:'metric',game_id:id,value:snapshot.revision}])
    },error:null,status:200};
   }
   if(name==='get_party_representation_projection'){
    const id=args.p_game_id;
    const rows=table=>fixtures.has(table)
     ?JSON.parse(JSON.stringify(fixtures.get(table))).filter(item=>item.game_id===id)
     :[];
    return {data:{
     invitations:rows('party_invitations').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))),
     mandates:rows('party_member_mandates'),
     agreements:rows('party_agreements').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
    },error:null,status:200};
   }
   if(name==='get_game_bootstrap_v2'){
    const snapshot={revision,user,gameId,memberKind},id=args.p_game_id;
    const num=(counts.get('games')||0)+1;counts.set('games',num);
    await holds.get('games:'+num)?.promise;
    const bundled=['games','state_metrics','game_events','chat_channels','game_stages','game_votes','game_evaluations','game_crises','game_documents','game_profiles','formal_documents'];
    const broken=bundled.find(table=>failures.has(table));
    if(broken)return{data:null,error:{message:'simulated read outage '+broken,code:failureCodes.get(broken)||'PGRST123'},status:400};
    const game={id,current_round:snapshot.revision,title:'revision-'+snapshot.revision};
    const fixtureRows=(table,defaults)=>{
     if(!fixtures.has(table))return defaults;
     return JSON.parse(JSON.stringify(fixtures.get(table))).filter(row=>row.game_id===id);
    };
    return{data:{
     game,metrics:fixtureRows('state_metrics',[{id:'metric',game_id:id,value:snapshot.revision}]),events:fixtureRows('game_events',[]),
     channels:fixtureRows('chat_channels',[{id:'channel-a',game_id:id,name:'Общий чат',kind:'public'}]),
     stages:fixtureRows('game_stages',[]),votes:fixtureRows('game_votes',withBallots?[{id:'vote',game_id:id}]:[]),
     evaluations:fixtureRows('game_evaluations',withBallots?[{id:'evaluation-'+snapshot.revision,user_id:snapshot.user}]:[]),
     crises:fixtureRows('game_crises',withBallots?[{id:'crisis-'+snapshot.revision,game_id:id}]:[]),
     documents:fixtureRows('game_documents',withBallots?[{id:'document-'+snapshot.revision,game_id:id,created_by:snapshot.user}]:[]),
     profiles:fixtureRows('game_profiles',assetPaths?[{game_id:id,user_id:snapshot.user,avatar_path:'teacher-assets/'+snapshot.user+'/avatar-fixture.webp',signature_path:'teacher-assets/'+snapshot.user+'/signature-fixture.png'}]:[]),
     formal_documents:fixtureRows('formal_documents',[])
    },error:null,status:200};
   }
   if(name==='get_my_game_identity'){
    const snapshot={revision,user,gameId,memberKind};
    const gameNumber=(counts.get('games')||0)+1;counts.set('games',gameNumber);
    const memberNumber=(counts.get('game_members')||0)+1;counts.set('game_members',memberNumber);
    await holds.get('games:'+gameNumber)?.promise;
    await holds.get('game_members:'+memberNumber)?.promise;
    if(failures.has('games'))return{data:null,error:{message:'simulated read outage games',code:failureCodes.get('games')}};
    if(failures.has('game_members'))return{data:null,error:{message:'simulated read outage game_members',code:failureCodes.get('game_members')}};
    return{data:{
     game:{id:snapshot.gameId,current_round:snapshot.revision,title:'revision-'+snapshot.revision},
     member:{game_id:snapshot.gameId,user_id:snapshot.user,full_name:snapshot.user,kind:snapshot.user==='teacher-a'?snapshot.memberKind:'student'}
    },error:null};
   }
   return{data:name==='has_seen_my_intro'?true:name==='get_my_chat_overview'?[{channel_id:'channel-a',unread_count:0}]:[],error:null};
  },
  storage:{from:()=>({createSignedUrl:async()=>{signed++;activeSigns++;peakSigns=Math.max(peakSigns,activeSigns);await tick();activeSigns--;return{data:{signedUrl:'https://example.invalid/media'},error:null}}})}
 };
 const win={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);},localStorage:{getItem:()=>null,setItem:()=>{}}};
 const doc={visibilityState:'visible',addEventListener:(name,fn)=>{const values=docListeners.get(name)||new Set();values.add(fn);docListeners.set(name,values);},removeEventListener:(name,fn)=>docListeners.get(name)?.delete(fn)};
 const module={exports:{}};
 function requireFor(name){
  if(name==='react')return react;
  if(name==='next/navigation')return{useRouter:()=>({replace:target=>redirects.push(target)})};
  if(name==='@/lib/supabase')return{supabase};
  if(name==='@/lib/localGameSnapshot')return{readLocalGameSnapshot:async()=>null,writeLocalGameSnapshot:async()=>{},deleteLocalGameSnapshot:async()=>{}};
  if(name==='@/lib/userError')return{userError:error=>String(error?.message||error)};
  if(name==='@/lib/resolveStoredAsset'){
   const raw=fs.readFileSync(path.join(root,'lib/resolveStoredAsset.ts'),'utf8');
   const compiled=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   const child={exports:{}};
   vm.runInNewContext('(function(require,module,exports){'+compiled+'\n})')(requireFor,child,child.exports);
   return child.exports;
  }
  if(name==='./useGameTableSync')return{notifyGameDataRefresh:(gameId,table)=>notices.push({gameId,table}),notifySectionUpdates:()=>{},setGameRealtimeConnection:()=>{}};
  if(name==='./useBudgetPulse')return{useBudgetPulse:()=>({budgetPulse:null,budgetPulseError:'',refreshBudgetPulse:async()=>{}}),withBudgetIncome:rows=>rows};
  if(name==='./gameRoster')return{currentGameMembers:(rows,id)=>rows.filter(row=>row.game_id===id),currentGameProfiles:(rows,_,id)=>rows.filter(row=>row.game_id===id)};
  if(name==='./chatChannelSelection'||name==='./chatRealtime'||name==='./coalesceInFlight'){
   const source=fs.readFileSync(path.join(root,'components/game',name.slice(2)+'.ts'),'utf8');
   const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   const child={exports:{}};
   vm.runInNewContext('(function(require,module,exports){'+compiled+'\n})')(requireFor,child,child.exports);
   return child.exports;
  }
  if(name==='./recordingMedia')return{CHAT_MAX_FILE_BYTES:25*1024*1024,preferredRecordingMime:()=>'',inferChatMime:file=>file.type,uploadedChatKind:()=> 'audio'};
  if(name==='./chatMediaTransport')return{sendChatMedia:async input=>{input.onPhase?.('uploading');await mediaSend.promise;input.onPhase?.('saving');return{ok:false,stage:'message',error:'old media save failure',pending:{messageId:'old-pending',path:'game-a/channel-a/teacher-a/old.webm'}};}};
  return{};
 }
 vm.runInNewContext('(function(require,module,exports){'+compiledCode+'\n})',{
  console,window:win,document:doc,Date:ClockDate,Promise,Map,Set,WeakMap,Object,Blob,AbortController,MediaRecorder:Recorder,
  navigator:{mediaDevices:{getUserMedia:()=>permission.promise}},
  URL:{revokeObjectURL:()=>{}},
  setTimeout:(fn,delay=0)=>{const id=++clock;timers.set(id,{fn,at:virtualNow+delay});return id;},clearTimeout:id=>timers.delete(id),
  setInterval:(fn,delay)=>{const id=++clock;timers.set(id,{fn,at:virtualNow+delay,interval:delay});return id;},clearInterval:id=>timers.delete(id)
 })(requireFor,module,module.exports);
 function render(id=gameId){cursor=0;dirty=false;gameId=id;const result=module.exports.useRepublicGame(id);while(pendingEffects.length)pendingEffects.shift()();return result;}
 async function settle(){for(let i=0;i<8;i++){render();await tick();if(!dirty)break;}return render();}
 return{
  render,settle,redirects,
  rpcCount:name=>started.get('rpc:'+name)||0,writeCount:table=>started.get('write:'+table)||0,failRpc:(name,code)=>rpcFailures.set(name,code),
  enableBallots(){withBallots=true;},readCount:table=>counts.get(table)||0,
  setRevision:value=>{revision=value;},setUser:value=>{user=value;},setMemberKind:value=>{memberKind=value;},setAssetPaths:value=>{assetPaths=value;},assetStats:()=>({signed,peakSigns}),failTable(table,code){failures.add(table);failureCodes.set(table,code);},setAuthError:value=>{authError=value;},
  hold(table,number=(counts.get(table)||0)+1){const pending=deferred();holds.set(table+':'+number,pending);return pending;},
  emit(table,row,eventType){for(const channel of [...channels])for(const {filter,callback} of channel.handlers)if(filter.table===table&&filter.event!=='DELETE')callback({eventType:eventType||(table==='chat_messages'?'UPDATE':'INSERT'),new:{game_id:gameId,...row}});},
  callbacks(table){return channels.flatMap(channel=>channel.handlers.filter(item=>item.filter.table===table).map(item=>item.callback))},
  auth(event,nextUser){user=nextUser;const before=requests;authCallback?.(event,nextUser?{user:{id:nextUser}}:null);assert.equal(requests,before,'Auth callback must schedule Supabase I/O outside its synchronous callback.');},
  runTimers(){for(const [id,timer] of [...timers]){if(timer.interval)continue;timers.delete(id);timer.fn();}},
  async advance(ms){await settle();const end=virtualNow+ms;let turns=0;while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert(++turns<10000,'Timers must remain bounded');virtualNow=next[1].at;if(next[1].interval)next[1].at+=next[1].interval;else timers.delete(next[0]);next[1].fn();await settle();}virtualNow=end;await settle();},
  visible(state){doc.visibilityState=state;for(const fn of docListeners.get('visibilitychange')||[])fn();},
  stats:()=>({requests,responseBytes,aborted,started:Object.fromEntries(started),notices:[...notices],queryLog:[...queryLog],timers:timers.size}),ignoreAbort(value){ignoreAbort=value;},fixture(table,rows){fixtures.set(table,rows)},
  resolveMedia(){permission.resolve({getTracks:()=>[{stop(){stoppedTracks++;}}]});},mediaState:()=>({recorders,stoppedTracks}),
  resolveMediaSend(){mediaSend.resolve();},
  dispose(){if(disposed)return;disposed=true;for(const slot of slots)slot?.cleanup?.();}
 };
}

async function main(){
 const failures=[];
 async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.message);}}
 await check('Newer full refresh survives a late response from the same game',async()=>{
  const h=harness(),old=h.hold('games');const first=h.render().refresh();await tick();h.setRevision(2);await h.render().refresh();assert.equal(h.render().game.current_round,2);old.resolve();await first;assert.equal(h.render().game.current_round,2);h.dispose();
 });
 await check('Party documents realtime refreshes only documents, not every core table',async()=>{
  const h=harness({effects:true});
  await h.settle();
  h.render().setActiveView('parties');
  await h.settle();
  const coreBefore=h.readCount('games'),documentsBefore=h.readCount('party_documents');
  h.emit('party_documents');
  await h.settle();
  assert(h.readCount('party_documents')>documentsBefore,'New document metadata must reach the party screen');
  assert.equal(h.readCount('games'),coreBefore,'Uploading one file must not reload the full game');
 });
 await check('Storage signatures are cached and never exceed four parallel requests per client',async()=>{
  const h=harness({effects:true});h.setAssetPaths(true);
  await h.settle();h.render().setActiveView('parties');await h.settle();
  for(let i=0;i<15;i++)await tick();
  const first=h.assetStats();
  assert(first.signed>=12,'Asset fixture must exercise document, avatar and emblem signatures');
  assert(first.peakSigns<=4,'Client must not launch more than four simultaneous Storage sign requests');
  await h.render().refresh();await h.settle();
  assert.equal(h.assetStats().signed,first.signed,'Unchanged Storage paths must reuse session-scoped signed URLs');
  h.dispose();
 });
 await check('Initial game hydration makes five core reads including one bundled RPC under four-slot limit',async()=>{
  const source=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8');
  const start=source.indexOf('async function loadCoreSections()'),end=source.indexOf('async function hydrateActiveView(',start);
  assert(start>=0&&end>start);
  assert.equal((source.slice(start,end).match(/limitedCoreRead\(/g)||[]).length,3);
  assert(source.includes("supabase.rpc('get_game_bootstrap_v2'"),'Server-side RLS bundle replaces eleven HTTP requests');
  assert(source.includes("function readLegacyBootstrap()"),'Absent-schema fallback remains available');
  assert(source.includes(".eq('user_id',uid).maybeSingle()"),'Personal membership stays independent of full roster');
  assert(source.slice(start,end).includes('loadCachedParties()'),'One core table uses a shared cache, with its query still queue-limited');
  assert(source.includes("const request=limitedCoreRead(supabase.from('game_parties')"),'Party reads preserve four-slot limiter');
  assert(source.slice(start,end).includes('loadMemberRoster()'),'The separately authorised roster remains shared and concurrency limited');
  assert(source.includes('coreReadQueue.current.active<4'));
 });
 await check('40 simultaneous synthetic clients hydrate 11 table groups with 40 rather than 440 REST operations',async()=>{
  const clients=Array.from({length:40},()=>harness({effects:true}));
  try{
   await Promise.all(clients.map(h=>h.settle()));
   for(const h of clients){
    assert.equal(h.rpcCount('get_game_bootstrap_v2'),1,'One grouped read per client');
    assert.equal(h.readCount('state_metrics'),0,'Political wall projection now includes metrics without an extra table read');
    assert.equal(h.readCount('formal_documents'),0,'Legacy document feed read is skipped');
    assert.equal(h.render().teacher,true);
    assert.equal(h.render().game.id,'game-a');
    assert.equal(h.render().metrics.length,1);
   }
  }finally{clients.forEach(h=>h.dispose());}
 });
 await check('Unavailable new RPC uses RLS-preserving legacy selects, without dropping the identity',async()=>{
  const h=harness();h.failRpc('get_game_bootstrap_v2','PGRST202');
  await h.render().refresh();
  assert(h.readCount('state_metrics')>0,'Older backend uses the existing RLS table read');
  assert.equal(h.render().teacher,true);
  h.dispose();
 });
 await check('40 synthetic teacher panels read one impact projection and preserve results',async()=>{
  const clients=Array.from({length:40},()=>harness({effects:true}));
  try{
   for(const h of clients){
    h.fixture('impact_rules',[{id:'rule-a',game_id:'game-a',rule_key:'education',priority:1,enabled:true}]);
    h.fixture('impact_ledger',[{id:1,game_id:'game-a',rule_key:'education',created_at:'2026-10-29T10:00:00Z',effects:{score:2}}]);
   }
   await Promise.all(clients.map(async h=>{await h.settle();h.render().setActiveView('teacher');await h.settle()}));
   for(const h of clients){
    assert(h.rpcCount('get_impact_engine_projection')>=1,'Teacher panel has one impact RPC');
    assert.equal(h.readCount('impact_rules'),0,'No separate rule HTTP request');
    assert.equal(h.readCount('impact_ledger'),0,'No separate ledger HTTP request');
    assert.equal(h.render().impactRules.length,1,'Rule state unchanged');
    assert.equal(h.render().impactLedger[0].effects.score,2,'Ledger effects unchanged');
   }
  }finally{clients.forEach(h=>h.dispose());}
 });
 await check('Missing impact RPC uses original RLS reads, overload does not fan out',async()=>{
  const legacy=harness({effects:true});legacy.failRpc('get_impact_engine_projection','PGRST202');
  await legacy.settle();legacy.render().setActiveView('teacher');await legacy.settle();
  assert(legacy.readCount('impact_rules')>=1);
  assert(legacy.readCount('impact_ledger')>=1);
  legacy.dispose();
  const failed=harness({effects:true});failed.failRpc('get_impact_engine_projection','PGRST003');
  await failed.settle();failed.render().setActiveView('teacher');await failed.settle();
  assert.equal(failed.readCount('impact_rules'),0);
  assert.equal(failed.readCount('impact_ledger'),0);
  failed.dispose();
 });
 await check('40 simulated party screens share a single grouped read instead of three independent reads',async()=>{
  const clients=Array.from({length:40},()=>harness({effects:true}));
  try{
   for(const h of clients)h.fixture('party_invitations',[{id:'invite-1',game_id:'game-a',party_id:'party-1',invited_user_id:'teacher-a',status:'pending',created_at:'2026-10-27T00:00:00Z'}]);
   await Promise.all(clients.map(async h=>{await h.settle();h.render().setActiveView('parties');await h.settle()}));
   for(const h of clients){
    assert(h.rpcCount('get_party_representation_projection')>=1,'Party screen fetches one grouped RLS projection');
    assert.equal(h.readCount('party_invitations'),0);
    assert.equal(h.readCount('party_member_mandates'),0);
    assert.equal(h.readCount('party_agreements'),0);
    assert.equal(h.render().partyInvitations?.length,1,'Existing invitations reach the screen');
   }
  }finally{clients.forEach(h=>h.dispose());}
 });
 await check('40 political wall clients each receive one projection and no six direct reads',async()=>{
  const clients=Array.from({length:40},()=>harness({effects:true}));
  try{
   await Promise.all(clients.map(h=>h.settle()));
   for(const h of clients){
    assert(h.rpcCount('get_political_wall_projection')>=1,'Political wall uses new invoker RPC');
    for(const table of ['political_posts','political_post_media','political_post_formal_links','state_metric_history','party_support_history']){
     assert.equal(h.readCount(table),0,'No direct '+table+' reads');
    }
   }
  }finally{clients.forEach(h=>h.dispose());}
 });
 await check('Missing political projection falls back under RLS; 402 never fans out',async()=>{
  const old=harness({effects:true});old.failRpc('get_political_wall_projection','PGRST202');
  await old.settle();assert(old.readCount('political_posts')>=1);old.dispose();
  const stop=harness({effects:true});stop.failRpc('get_political_wall_projection','PGRST003');
  await stop.settle();assert.equal(stop.readCount('political_posts'),0);stop.dispose();
 });
 await check('Missing projection allows backwards-compatible reads but overloaded RPC never fans out',async()=>{
  const old=harness({effects:true});old.failRpc('get_party_representation_projection','PGRST202');
  await old.render().refresh();old.render().setActiveView('parties');await old.settle();
  assert(old.readCount('party_invitations')>=1,'Old schema retains per-table RLS');old.dispose();
  const down=harness({effects:true});down.failRpc('get_party_representation_projection','PGRST003');
  await down.render().refresh();down.render().setActiveView('parties');await down.settle();
  assert.equal(down.readCount('party_invitations'),0,'No fallbacks on overload');down.dispose();
 });
  await check('100 simulated players submit one presence plus one navigation event in one network call',async()=>{
  const clients=Array.from({length:100},()=>harness());
  try{
   await Promise.all(clients.map(async h=>{
    await h.render().refresh();
    assert(h.render().me,'Client must have accepted server identity');
    const before=h.rpcCount('record_my_game_presence');
    await h.render().touchPresence('stages','Открыл раздел «Этапы»');
    assert.equal(h.rpcCount('record_my_game_presence'),before+1);
    assert.equal(h.writeCount('game_presence'),0,'The RPC does not need a separate client presence upsert');
    assert.equal(h.writeCount('game_activity'),0,'The RPC writes the journal within the same server transaction');
    await h.render().touchPresence('stages','Открыл раздел «Этапы»');
    assert.equal(h.rpcCount('record_my_game_presence'),before+1,'Duplicate same-view heartbeats remain throttled');
   }));
  }finally{clients.forEach(h=>h.dispose());}
 });
 await check('Presence RPC schema fallback and permission failure preserve original RLS path',async()=>{
  const h=harness();
  try{
   await h.render().refresh();
   h.failRpc('record_my_game_presence','PGRST202');
   await h.render().touchPresence('parties','Открыл раздел «Партия»');
   assert.equal(h.rpcCount('record_my_game_presence'),1);
   assert.equal(h.writeCount('game_presence'),1);
   assert.equal(h.writeCount('game_activity'),1,'Legacy fallback preserves the navigation journal');
  }finally{h.dispose();}
  const denied=harness();
  try{
   await denied.render().refresh();
   denied.failRpc('record_my_game_presence','42501');
   await denied.render().touchPresence('parties','Открыл раздел «Партия»');
   assert.equal(denied.writeCount('game_presence'),0,'RLS denial must never retry through another write path');
   assert.equal(denied.writeCount('game_activity'),0);
  }finally{denied.dispose();}
 });
 await check('40 simulated simultaneous party panels survive the same document update',async()=>{
  const clients=Array.from({length:40},()=>harness({effects:true}));
  await Promise.all(clients.map(async h=>{await h.settle();h.render().setActiveView('parties');await h.settle();}));
  const coreReads=clients.map(h=>h.readCount('games'));
  for(const h of clients)h.emit('party_documents');
  await Promise.all(clients.map(h=>h.settle()));
  clients.forEach((h,index)=>{
   assert.equal(h.readCount('games'),coreReads[index],'A version update must not fan out into a full reload');
   assert.equal(h.render().parties.length,1);
   h.dispose();
  });
 });
 await check('40 simulated clients keep their sections isolated during a document update',async()=>{
  const clients=Array.from({length:40},()=>harness({effects:true}));
  const views=['parties','stages','documents','teacher','budget','actions','votes','dashboard'];
  await Promise.all(clients.map(async(h,i)=>{
   await h.settle();h.render().setActiveView(views[i%views.length]);await h.settle();
  }));
  const before=clients.map(h=>h.readCount('games'));
  for(const h of clients)h.emit('party_documents');
  await Promise.all(clients.map(h=>h.settle()));
  clients.forEach((h,i)=>{
   assert.equal(h.readCount('games'),before[i],'A document update must not reload all core tables for any client');
   assert.equal(h.render().parties.length,1,'The party list must remain available to each client');
   h.dispose();
  });
 });
 await check('Party records survive a document-table failure',async()=>{
  const h=harness({effects:true});
  h.failTable('party_documents');
  await h.settle();
  h.render().setActiveView('parties');
  await h.settle();
  assert.equal(h.render().parties.length,1,'A document outage must not erase the party list');
 });
 await check('Party records survive an optional representation failure',async()=>{
  const h=harness({effects:true});
  h.failTable('party_agreements');
  await h.settle();
  h.render().setActiveView('parties');
  await h.settle();
  assert.equal(h.render().parties.length,1,'Agreements must not block the party list');
 });
 await check('User changes invalidate an older teacher response',async()=>{
  const h=harness(),old=h.hold('games');const first=h.render().refresh();await tick();h.setUser('student-b');h.setRevision(2);await h.render().refresh();assert.equal(h.render().me.user_id,'student-b');old.resolve();await first;assert.equal(h.render().me.user_id,'student-b');assert.equal(h.render().teacher,false);h.dispose();
 });
 await check('Failed optional table reads retain accepted data and expose an error',async()=>{
  const h=harness();await h.render().refresh();assert.equal(h.render().metrics.length,1);h.failTable('state_metrics');await h.render().refresh();assert.equal(h.render().metrics.length,1);assert.match(h.render().error,/simulated read outage/);h.dispose();
 });
 await check('Missing session clears old private data before navigation',async()=>{
  const h=harness();await h.render().refresh();h.setUser(null);await h.render().refresh();assert.equal(h.render().me,null);assert.equal(h.render().teacher,false);assert.equal(h.render().game,null);assert.equal(h.render().messages.length,0);assert.equal(h.redirects.at(-1),'/');h.dispose();
 });
 await check('Auth events clear private state synchronously and reject pending reads',async()=>{
  const h=harness({effects:true});await h.settle();assert.equal(h.render().teacher,true);const old=h.hold('games');h.setRevision(2);const first=h.render().refresh();await tick();h.auth('SIGNED_OUT',null);assert.equal(h.render().me,null);assert.equal(h.render().game,null);old.resolve();await first;assert.equal(h.render().me,null);assert.equal(h.render().messages.length,0);h.runTimers();await h.settle();assert.equal(h.redirects.at(-1),'/');h.dispose();
 });
 for(const transition of ['sign out','switch user','switch game','newer refresh']){
  await check('Late ballot read cannot restore old data after '+transition,async()=>{
   const h=harness({effects:true});h.enableBallots();await h.settle();
   const count=h.readCount('game_ballots'),old=h.hold('game_ballots');
   const first=h.render().refresh();await h.settle();
   assert.equal(h.readCount('game_ballots'),count+1,'The original refresh must reach the delayed ballot request');
   if(transition==='sign out')h.auth('SIGNED_OUT',null);
   if(transition==='switch user'){h.auth('SIGNED_IN','student-b');h.runTimers();await h.settle();}
   if(transition==='switch game'){h.render('game-b');await h.settle();}
   if(transition==='newer refresh'){h.setRevision(2);await h.render().refresh();}
   old.resolve();await first;await h.settle();
   const current=h.render();
   if(transition==='sign out'){
    assert.equal(current.me,null);assert.equal(current.game,null);
    for(const key of ['ballots','evaluations','crises','documents'])assert.equal(current[key].length,0,key+' must remain cleared');
   }
   if(transition==='switch user')assert.equal(current.evaluations[0].user_id,'student-b');
   if(transition==='switch game')assert.equal(current.documents[0].game_id,'game-b');
   if(transition==='newer refresh'){
    assert.equal(current.ballots[0].id,'ballot-2');assert.equal(current.evaluations[0].id,'evaluation-2');
   }
   h.dispose();
  });
 }
 await check('Auth user switch reloads outside the callback without restoring teacher access',async()=>{
  const h=harness({effects:true});await h.settle();const old=h.hold('games');const first=h.render().refresh();await tick();h.auth('SIGNED_IN','student-b');assert.equal(h.render().teacher,false);assert.equal(h.render().me,null);h.runTimers();await h.settle();assert.equal(h.render().me.user_id,'student-b');old.resolve();await first;assert.equal(h.render().me.user_id,'student-b');h.dispose();
 });
 await check('Rejected auth I/O leaves loading and reports a recoverable error',async()=>{
  const h=harness({effects:true});h.setAuthError(new Error('simulated auth network rejection'));await h.settle();assert.equal(h.render().loading,false);assert.match(h.render().error,/simulated auth network rejection/);h.dispose();
 });
 await check('Partial realtime reads coalesce behind one request and retain the trailing version',async()=>{
  const h=harness({effects:true});await h.settle();const olderWall=h.hold('political_wall');h.setRevision(2);h.emit('political_posts');await h.advance(1000);
  const before=h.rpcCount('get_political_wall_projection');h.setRevision(3);h.emit('political_posts');await h.advance(1000);assert.equal(h.rpcCount('get_political_wall_projection'),before,'An in-flight read is not duplicated');
  olderWall.resolve();await h.settle();await h.advance(3000);assert.equal(h.render().politicalPosts[0].id,'post-3');
  const full=h.hold('games');h.setRevision(4);const refresh=h.render().refresh();await tick();h.setRevision(5);h.emit('political_posts');await h.advance(1000);full.resolve();await refresh;assert.equal(h.render().game.current_round,5);assert.equal(h.render().metrics[0].value,5);h.dispose();
 });
 await check('Same-channel message refresh keeps the latest accepted history',async()=>{
  const h=harness({effects:true});await h.settle();h.render().setChatOpen(true);await h.settle();assert.equal(h.render().channelId,'channel-a');const old=h.hold('chat_messages');h.setRevision(2);h.emit('chat_messages');await tick();h.setRevision(3);h.emit('chat_messages');await h.settle();assert.equal(h.render().messages[0].id,'message-3');old.resolve();await h.settle();assert.equal(h.render().messages[0].id,'message-3');h.dispose();
 });
 await check('A completed send in an old channel does not cancel the new channel history',async()=>{
  const h=harness({effects:true});await h.settle();const newChannel=h.hold('chat_messages');h.setRevision(2);h.render().setChannelId('channel-b');h.render();await tick();await h.render().sendText('earlier message','channel-a');newChannel.resolve();await h.settle();assert.equal(h.render().messages[0].channel_id,'channel-b');assert.equal(h.render().chatLoading,false);h.dispose();
 });
 await check('An older partial response cannot restore data from another game',async()=>{
  const h=harness({effects:true});await h.settle();const old=h.hold('political_wall');h.setRevision(2);h.emit('political_posts');await tick();h.setRevision(3);h.render('game-b');await h.settle();assert.equal(h.render().game.id,'game-b');old.resolve();await h.settle();assert.equal(h.render().politicalPosts[0].game_id,'game-b');assert.equal(h.render().politicalPosts[0].id,'post-3');h.dispose();
 });
 await check('Same-user auth events retain accepted state',async()=>{
  const h=harness({effects:true});await h.settle();h.auth('SIGNED_IN','teacher-a');h.auth('TOKEN_REFRESHED','teacher-a');assert.equal(h.render().me.user_id,'teacher-a');assert.equal(h.render().game.current_round,1);assert.equal(h.render().teacher,true);h.dispose();
 });
 await check('A latest background refresh also completes initial loading',async()=>{
  const h=harness({effects:true}),old=h.hold('games');h.render();await tick();h.setRevision(2);await h.render().refresh();assert.equal(h.render().loading,false);old.resolve();await h.settle();assert.equal(h.render().loading,false);assert.equal(h.render().game.current_round,2);h.dispose();
 });
 await check('Unmounted reads cannot publish state',async()=>{
  const h=harness({effects:true});await h.settle();const old=h.hold('games');h.setRevision(2);const refresh=h.render().refresh();await tick();h.dispose();old.resolve();await refresh;assert.equal(h.render().game.current_round,1);
 });
 await check('A late microphone permission response cannot start capture after unmount',async()=>{
  const h=harness({effects:true});await h.settle();h.render().setChatOpen(true);await h.settle();const recording=h.render().toggleRecording('audio');await tick();h.dispose();h.resolveMedia();await recording;assert.equal(h.mediaState().recorders,0);assert.equal(h.mediaState().stoppedTracks,1);assert.equal(h.render().recording,null);
 });
 await check('Late media completion cannot restore old upload state after sign out',async()=>{
  const h=harness({effects:true});await h.settle();h.render().setChatOpen(true);await h.settle();const file=new Blob(['recording'],{type:'audio/webm'});file.name='voice.webm';const sending=h.render().sendChatFile(file);await tick();assert.equal(h.render().chatMediaPhase,'uploading');h.auth('SIGNED_OUT',null);assert.equal(h.render().chatMediaPhase,'idle');h.resolveMediaSend();assert.equal(await sending,false);assert.equal(h.render().chatMediaPhase,'idle');assert.equal(h.render().chatMediaError,'');h.dispose();
 });
 await check('Membership demotion clears old privileges and private data despite an optional read failure',async()=>{
  const h=harness({effects:true});await h.settle();h.render().setChatOpen(true);await h.settle();assert.equal(h.render().teacher,true);assert.equal(h.render().messages.length,1);h.setMemberKind('observer');h.failTable('state_metrics');await h.render().refresh();assert.equal(h.render().teacher,false);assert.equal(h.render().me.kind,'observer');assert.equal(h.render().messages.length,0);h.runTimers();await h.settle();assert.equal(h.render().teacher,false);assert.equal(h.render().metrics.length,0);assert.match(h.render().error,/simulated read outage/);h.dispose();
 });
 await check('Confirmed lost game membership removes the previous accepted game',async()=>{
  const h=harness({effects:true});await h.settle();h.failTable('game_members','PGRST116');const refreshing=h.render().refresh();await tick();h.runTimers();await refreshing;assert.equal(h.render().me,null);assert.equal(h.render().game,null);assert.equal(h.render().teacher,false);assert.equal(h.render().messages.length,0);assert.equal(h.render().loading,false);assert.equal(h.render().error,'Нет доступа к игре');h.dispose();
 });
 if(failures.length)process.exitCode=1;
}
// Fake timers inside the hook must not let Node exit successfully while the
// last asynchronous test is still unresolved.
module.exports={harness};
if(require.main===module){
 const watchdog=setTimeout(()=>{console.error('FAIL Hook regression suite did not complete');process.exitCode=1;},15000);
 main().then(()=>clearTimeout(watchdog),error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
}
