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

function harness({effects=false}={}){
 const slots=[],pendingEffects=[],channels=[],timers=new Map(),listeners=new Map(),counts=new Map(),holds=new Map(),failures=new Set(),failureCodes=new Map();
 let cursor=0,dirty=false,revision=1,user='teacher-a',memberKind='teacher',gameId='game-a',authCallback,authError=null,clock=0,requests=0,disposed=false,recorders=0,stoppedTracks=0;
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
   getUser:async()=>{requests++;if(authError)throw authError;return{data:{user:user?{id:user}:null},error:null};},
   onAuthStateChange(callback){authCallback=callback;return{data:{subscription:{unsubscribe(){if(authCallback===callback)authCallback=undefined;}}}};},
   signOut:async()=>{user=null;authCallback?.('SIGNED_OUT',null);return{error:null};}
  },
  channel(){const handlers=[];const channel={on(kind,filter,callback){handlers.push({filter,callback});return this;},subscribe(){return this;},handlers};channels.push(channel);return channel;},
  removeChannel:async channel=>{const index=channels.indexOf(channel);if(index!==-1)channels.splice(index,1);},
  from(table){
   requests++;const number=(counts.get(table)||0)+1;counts.set(table,number);
   const snapshot={revision,user,gameId,memberKind};
   const query={singleRow:false,eqs:{},select(){return this;},order(){return this;},limit(){return this;},eq(key,value){this.eqs[key]=value;return this;},single(){this.singleRow=true;return this;},maybeSingle(){this.singleRow=true;return this;},in(){return this;},
    async then(resolve,reject){try{
     await holds.get(table+':'+number)?.promise;
     const id=this.eqs.game_id||snapshot.gameId;
     let data=[];
     if(table==='games')data={id:this.eqs.id||snapshot.gameId,current_round:snapshot.revision,title:'revision-'+snapshot.revision};
     if(table==='game_members'){const member={game_id:id,user_id:snapshot.user,full_name:snapshot.user,kind:snapshot.user==='teacher-a'?snapshot.memberKind:'student'};data=this.singleRow?member:[member];}
     if(table==='state_metrics')data=[{id:'metric',game_id:id,value:snapshot.revision}];
     if(table==='game_parties')data=[{id:'party-'+snapshot.revision,game_id:id,name:'party-'+snapshot.revision}];
     if(table==='political_posts')data=[{id:'post-'+snapshot.revision,game_id:id,title:'post-'+snapshot.revision}];
     if(table==='chat_channels')data=[{id:'channel-a',game_id:id,name:'Общий чат',kind:'public'}];
     if(table==='chat_messages')data=[{id:'message-'+snapshot.revision,game_id:id,channel_id:this.eqs.channel_id||'channel-a',text:'message-'+snapshot.revision,created_at:'2026-10-08T10:00:00Z'}];
     resolve(failures.has(table)?{data:null,error:{message:'simulated read outage '+table,code:failureCodes.get(table)}}:{data,error:null});
    }catch(error){reject(error);}}
   };return query;
  },
  rpc:async(name,args)=>{requests++;return{data:name==='has_seen_my_intro'?true:name==='get_my_chat_overview'?[{channel_id:'channel-a',unread_count:0}]:[],error:null};},
  storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://example.invalid/media'},error:null})})}
 };
 const win={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);},localStorage:{getItem:()=>null,setItem:()=>{}}};
 const doc={visibilityState:'visible',addEventListener:()=>{},removeEventListener:()=>{}};
 const module={exports:{}};
 function requireFor(name){
  if(name==='react')return react;
  if(name==='next/navigation')return{useRouter:()=>({replace:target=>redirects.push(target)})};
  if(name==='@/lib/supabase')return{supabase};
  if(name==='@/lib/userError')return{userError:error=>String(error?.message||error)};
  if(name==='./useGameTableSync')return{notifyGameDataRefresh:()=>{}};
  if(name==='./useBudgetPulse')return{useBudgetPulse:()=>({budgetPulse:null,budgetPulseError:'',refreshBudgetPulse:async()=>{}}),withBudgetIncome:rows=>rows};
  if(name==='./gameRoster')return{currentGameMembers:(rows,id)=>rows.filter(row=>row.game_id===id),currentGameProfiles:(rows,_,id)=>rows.filter(row=>row.game_id===id)};
  if(name==='./recordingMedia')return{CHAT_MAX_FILE_BYTES:25*1024*1024,preferredRecordingMime:()=>'',inferChatMime:file=>file.type,uploadedChatKind:()=> 'audio'};
  if(name==='./chatMediaTransport')return{sendChatMedia:async input=>{input.onPhase?.('uploading');await mediaSend.promise;input.onPhase?.('saving');return{ok:false,stage:'message',error:'old media save failure',pending:{messageId:'old-pending',path:'game-a/channel-a/teacher-a/old.webm'}};}};
  return{};
 }
 vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{
  console,window:win,document:doc,Date,Promise,Map,Set,WeakMap,Object,Blob,MediaRecorder:Recorder,
  navigator:{mediaDevices:{getUserMedia:()=>permission.promise}},
  URL:{revokeObjectURL:()=>{}},
  setTimeout:fn=>{const id=++clock;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  setInterval:()=>++clock,clearInterval:()=>{}
 })(requireFor,module,module.exports);
 function render(id=gameId){cursor=0;dirty=false;gameId=id;const result=module.exports.useRepublicGame(id);while(pendingEffects.length)pendingEffects.shift()();return result;}
 async function settle(){for(let i=0;i<8;i++){render();await tick();if(!dirty)break;}return render();}
 return{
  render,settle,redirects,
  setRevision:value=>{revision=value;},setUser:value=>{user=value;},setMemberKind:value=>{memberKind=value;},failTable(table,code){failures.add(table);failureCodes.set(table,code);},setAuthError:value=>{authError=value;},
  hold(table,number=(counts.get(table)||0)+1){const pending=deferred();holds.set(table+':'+number,pending);return pending;},
  emit(table){for(const channel of [...channels])for(const {filter,callback} of channel.handlers)if(filter.table===table&&filter.event!=='DELETE')callback({eventType:'INSERT',new:{game_id:gameId}});},
  auth(event,nextUser){user=nextUser;const before=requests;authCallback?.(event,nextUser?{user:{id:nextUser}}:null);assert.equal(requests,before,'Auth callback must schedule Supabase I/O outside its synchronous callback.');},
  runTimers(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}},
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
 await check('Auth user switch reloads outside the callback without restoring teacher access',async()=>{
  const h=harness({effects:true});await h.settle();const old=h.hold('games');const first=h.render().refresh();await tick();h.auth('SIGNED_IN','student-b');assert.equal(h.render().teacher,false);assert.equal(h.render().me,null);h.runTimers();await h.settle();assert.equal(h.render().me.user_id,'student-b');old.resolve();await first;assert.equal(h.render().me.user_id,'student-b');h.dispose();
 });
 await check('Rejected auth I/O leaves loading and reports a recoverable error',async()=>{
  const h=harness({effects:true});h.setAuthError(new Error('simulated auth network rejection'));await h.settle();assert.equal(h.render().loading,false);assert.match(h.render().error,/simulated auth network rejection/);h.dispose();
 });
 await check('Partial loader response order is guarded without canceling full core data',async()=>{
  const h=harness({effects:true});await h.settle();const olderWall=h.hold('political_posts');h.setRevision(2);h.emit('political_posts');await tick();h.setRevision(3);h.emit('political_posts');await h.settle();assert.equal(h.render().politicalPosts[0].id,'post-3');olderWall.resolve();await h.settle();assert.equal(h.render().politicalPosts[0].id,'post-3');
  const full=h.hold('games');h.setRevision(4);const refresh=h.render().refresh();await tick();h.setRevision(5);h.emit('political_posts');await h.settle();full.resolve();await refresh;assert.equal(h.render().game.current_round,4);assert.equal(h.render().metrics[0].value,5);h.dispose();
 });
 await check('Same-channel message refresh keeps the latest accepted history',async()=>{
  const h=harness({effects:true});await h.settle();assert.equal(h.render().channelId,'channel-a');const old=h.hold('chat_messages');h.setRevision(2);h.emit('chat_messages');await tick();h.setRevision(3);h.emit('chat_messages');await h.settle();assert.equal(h.render().messages[0].id,'message-3');old.resolve();await h.settle();assert.equal(h.render().messages[0].id,'message-3');h.dispose();
 });
 await check('A completed send in an old channel does not cancel the new channel history',async()=>{
  const h=harness({effects:true});await h.settle();const newChannel=h.hold('chat_messages');h.setRevision(2);h.render().setChannelId('channel-b');h.render();await tick();await h.render().sendText('earlier message','channel-a');newChannel.resolve();await h.settle();assert.equal(h.render().messages[0].channel_id,'channel-b');assert.equal(h.render().chatLoading,false);h.dispose();
 });
 await check('An older partial response cannot restore data from another game',async()=>{
  const h=harness({effects:true});await h.settle();const old=h.hold('political_posts');h.setRevision(2);h.emit('political_posts');await tick();h.setRevision(3);h.render('game-b');await h.settle();assert.equal(h.render().game.id,'game-b');old.resolve();await h.settle();assert.equal(h.render().politicalPosts[0].game_id,'game-b');assert.equal(h.render().politicalPosts[0].id,'post-3');h.dispose();
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
  const h=harness({effects:true});await h.settle();const recording=h.render().toggleRecording('audio');await tick();h.dispose();h.resolveMedia();await recording;assert.equal(h.mediaState().recorders,0);assert.equal(h.mediaState().stoppedTracks,1);assert.equal(h.render().recording,null);
 });
 await check('Late media completion cannot restore old upload state after sign out',async()=>{
  const h=harness({effects:true});await h.settle();const file=new Blob(['recording'],{type:'audio/webm'});file.name='voice.webm';const sending=h.render().sendChatFile(file);await tick();assert.equal(h.render().chatMediaPhase,'uploading');h.auth('SIGNED_OUT',null);assert.equal(h.render().chatMediaPhase,'idle');h.resolveMediaSend();assert.equal(await sending,false);assert.equal(h.render().chatMediaPhase,'idle');assert.equal(h.render().chatMediaError,'');h.dispose();
 });
 await check('Membership demotion clears old privileges and private data despite an optional read failure',async()=>{
  const h=harness({effects:true});await h.settle();assert.equal(h.render().teacher,true);assert.equal(h.render().messages.length,1);h.setMemberKind('observer');h.failTable('state_metrics');await h.render().refresh();assert.equal(h.render().teacher,false);assert.equal(h.render().me.kind,'observer');assert.equal(h.render().messages.length,0);h.runTimers();await h.settle();assert.equal(h.render().teacher,false);assert.equal(h.render().metrics.length,0);assert.match(h.render().error,/simulated read outage/);h.dispose();
 });
 await check('Confirmed lost game membership removes the previous accepted game',async()=>{
  const h=harness({effects:true});await h.settle();h.failTable('game_members','PGRST116');await h.render().refresh();assert.equal(h.render().me,null);assert.equal(h.render().game,null);assert.equal(h.render().teacher,false);assert.equal(h.render().messages.length,0);assert.equal(h.render().loading,false);assert.match(h.render().error,/simulated read outage/);h.dispose();
 });
 if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
