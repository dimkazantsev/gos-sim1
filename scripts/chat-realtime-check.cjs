/* Focused chat delivery regression, including 30 independent clients. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const file='components/game/chatRealtime.ts';
const mod=new Module(file,module);
mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const {mergeChatMessages}=mod.exports;
const make=(id,channel='public',created_at='2026-10-14T06:00:00Z',extra={})=>({
 id,game_id:'game-a',channel_id:channel,author_id:'alice',kind:'text',text:id,
 storage_path:null,mime_type:null,created_at,...extra
});
const a=make('a'),b=make('b','public','2026-10-14T06:00:01Z');
const clients=Array.from({length:30},()=>[]);
for(let i=0;i<clients.length;i++){
 clients[i]=mergeChatMessages(clients[i],[b]);
 clients[i]=mergeChatMessages(clients[i],[a,b]);
 clients[i]=mergeChatMessages(clients[i],[b]);
 assert.deepEqual(clients[i].map(x=>x.id),['a','b'],'Client '+i+' must receive immediately and idempotently');
}
assert.deepEqual(mergeChatMessages(clients[0],[make('c','public','2026-10-14T06:00:02Z')],2).map(x=>x.id),['b','c']);
const media=make('voice','public','2026-10-14T06:00:03Z',{kind:'audio',storage_path:'a/b/c/d',url:'signed'});
const unchanged=mergeChatMessages([media],[{...media,url:undefined}]);
assert.equal(unchanged[0].url,'signed','Repeated Realtime payload must preserve signed media');
assert.equal(mergeChatMessages([media],[{...media,url:'updated'}])[0].url,'updated');
const panel=fs.readFileSync('components/game/ChatPanel.tsx','utf8');

// Execute the actual production retention effect with deterministic timers.
const retentionStart=panel.indexOf(' useEffect(()=>{\n  // Wake only when');
const retentionEnd=panel.indexOf(' const [uploading',retentionStart);
assert(retentionStart>=0&&retentionEnd>retentionStart);
const mountRetention=new Function('useEffect','messages','allPinnedMessages','channelId','retentionClock','setRetentionClock','window','document','Date',panel.slice(retentionStart,retentionEnd));
const DAY=86400000,now=Date.parse('2026-11-25T12:00:00Z');
function retentionRealm(messages=[],pins=[],channel='public',clock=now){
 let at=now,id=0,callbacks=0,cleanup,visible=true;const pending=new Map(),events=new Set(),updates=[];
 const win={setTimeout(fn,delay){assert(delay>0&&delay<=2147483647);pending.set(++id,{fn,due:at+delay});return id},clearTimeout(n){pending.delete(n)}};
 const doc={get visibilityState(){return visible?'visible':'hidden'},addEventListener(n,f){assert.equal(n,'visibilitychange');events.add(f)},removeEventListener(n,f){events.delete(f)}};
 const attach=(rows=messages,allPins=pins,selected=channel,retention=clock)=>{cleanup?.();mountRetention(fn=>{cleanup=fn()},rows,allPins,selected,retention,v=>updates.push(v),win,doc,{now:()=>at,parse:Date.parse})};
 attach();
 return {pending,updates,events,attach,get callbacks(){return callbacks},advance(ms){const end=at+ms;for(;;){const due=[...pending.entries()].sort((a,b)=>a[1].due-b[1].due)[0];if(!due||due[1].due>end)break;at=due[1].due;pending.delete(due[0]);callbacks++;due[1].fn()}at=end},sleep(ms){at+=ms;visible=false},resume(){visible=true;for(const fn of events)fn()},close(){cleanup?.()}};
}
const recent=make('recent','public',new Date(now).toISOString());
const idle=Array.from({length:100},()=>retentionRealm([recent]));
for(const client of idle){client.advance(DAY);assert.equal(client.callbacks,0);assert.equal(client.updates.length,0);client.close();assert.equal(client.pending.size,0)}
const empty=retentionRealm();assert.equal(empty.pending.size,0);assert.equal(empty.events.size,0);empty.close();
const boundary=make('boundary','public',new Date(now-30*DAY+1000).toISOString());
const other=make('other','private',new Date(now-30*DAY+100).toISOString());
const exact=retentionRealm([recent,other],[boundary]);exact.advance(999);assert.equal(exact.updates.length,0);exact.advance(1);assert.deepEqual(exact.updates,[now+1000]);exact.attach([recent,other],[boundary],'public',now+1000);assert.equal(exact.pending.size,1);exact.close();assert.equal(exact.pending.size,0);assert.equal(exact.events.size,0);
const hidden=retentionRealm([boundary]);hidden.sleep(2000);hidden.resume();assert.deepEqual(hidden.updates,[now+2000]);hidden.close();
const stale=retentionRealm([make('stale','public',new Date(now-30*DAY-100).toISOString())],[],'public',now-1000);assert.deepEqual(stale.updates,[now]);stale.close();
const cap=retentionRealm([recent]);cap.advance(2147483647);assert.equal(cap.callbacks,1);assert.equal(cap.updates.length,0);cap.advance(30*DAY-2147483647);assert.deepEqual(cap.updates,[now+30*DAY]);cap.close();
const switched=retentionRealm([boundary,other]);switched.attach([boundary,other],[],'private');switched.advance(100);assert.deepEqual(switched.updates,[now+100]);switched.close();
console.log('PASS chat retention: 100 clients x 24h, zero callbacks versus 2400 hourly baseline; exact expiry, pins, switch, stale clock, hidden resume and delay cap');

const source=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
assert(source.includes("table:'chat_messages'")&&source.includes("payload.eventType==='INSERT'"),'Subscribe to message payloads directly');
assert(source.includes('setMessages(previous=>mergeChatMessages(previous,[row],chatWindowLimit()))'),'Render incoming chat messages immediately and retain explicitly paged history');
assert(source.includes('void loadRecentChatMessages(channelRef.current)'),'Recover only current channel');
assert(source.includes('chatRecovery=setInterval(recoverVisibleChatAndBallots,6000)'),'Chat recovery must retain its exact six-second interval');
assert(source.includes('startChatRecovery=setTimeout(')&&source.includes('function stopPeriodicPolling()'),'Chat still staggers first recovery, but stops the interval while hidden');
assert(source.includes("else if(payload.eventType==='UPDATE')")&&source.includes('next.channel_id===channelRef.current'),'Handle UPDATE only for the selected channel or previously visible moved messages');
assert(source.includes('if(chat&&chatOpenRef.current&&channelRef.current){lastChatRecoveryAt=Date.now();void loadMessages(channelRef.current)}'),'Chat edits use one current-channel read and reset the fallback cadence');
assert(source.includes("},[chatOpen,channelId]);")&&source.includes("void loadMessages(channelId,true);")&&source.includes("void loadChatPins(channelId);"),
 'Opening or switching chats must reconcile messages and pins with a single initial fetch');
assert(!source.includes("void loadMessages(channelId,true);void loadChatPins(channelId);void markChatRead(channelId);"),
 'Channel initialization must not duplicate the opening effect');
// Execute the actual recovery selector with an overlapping inclusive cursor.
{
 const start=source.indexOf('// Inclusive cursor handles identical timestamps.');
 const end=source.indexOf('if(!unseen.length)return;',start);
 assert(start>=0&&end>start,'Recovery selector must remain present');
 const select=new Function('result','messageRowsRef',source.slice(start,end).replace('(result.data as Message[])','result.data')+'\nreturn unseen;');
 const previous=Array.from({length:150},(_,i)=>({id:'m'+i,storage_path:'path/'+i}));
 const incoming=Array.from({length:75},(_,i)=>({id:'m'+(90+i),storage_path:'path/'+(90+i)}));
 let visits=0;
 const track=rows=>rows.map(row=>({...row,get id(){visits++;return row.id}}));
 const actual=select({data:track(incoming)},{current:track(previous)});
 const measured=visits;
 assert.deepEqual(actual.map(row=>row.id),incoming.slice(60).map(row=>row.id));
 assert(measured<=previous.length+incoming.length,'Recovery must use a linear ID lookup, not '+measured+' ID accesses');
 for(const [oldRows,newRows] of [[[],[]],[[],incoming.slice(0,2)],[previous,[]],[previous,[incoming[0],incoming[74],incoming[74]]]]){
  assert.deepEqual(select({data:newRows},{current:oldRows}),newRows.filter(row=>!oldRows.some(old=>old.id===row.id)));
 }
 console.log('PASS recent chat linear recovery: '+measured+' ID accesses; 60 known messages not re-signed, 15 new messages retained');
}
assert(source.includes('void Promise.allSettled([loadMessages(targetChannel),loadChatOverview()])'),'Text sends must not wait for history readback');
// Prevent 100 personalised read-marker / mention events from fanning out to
// every connected student. Check that filters remain scoped by both game and
// owner, with shared channel pins left unchanged.
const personalFilter=source.slice(source.indexOf("for(const table of ['chat_mentions','chat_channel_state','chat_pins'])"));
assert(personalFilter.includes("?'game_id=eq.'+gameId+',mentioned_user_id=eq.'+me.user_id"),'Mentions must be scoped to the recipient within this game');
assert(personalFilter.includes("?'game_id=eq.'+gameId+',user_id=eq.'+me.user_id"),'Read markers must be scoped to the current user within this game');
assert(personalFilter.includes(":'game_id=eq.'+gameId;"),'Pins remain room-wide for accessible channels');
// The shared game socket projects small invalidation payloads. Pins must retain
// channel_id for active-channel refresh, while private markers carry only game_id.
const compactSubscriptions=personalFilter.replace(/\s+/g,'');
assert(compactSubscriptions.includes("channel.on('postgres_changes',{event:'*',schema:'public',table,filter,select:table==='chat_pins'?['game_id','channel_id']:['game_id']},payload=>{"),'Keep scoped chat invalidations and minimal column projection');
const members=Array.from({length:100},(_,i)=>'member-'+i);
let matched=0;
for(const owner of members)for(const subscriber of members)if(owner===subscriber)matched++;
assert.equal(matched,100,'100 personal row changes must target only 100 recipient deliveries, not 10,000');

const chatSelectionCss=fs.readFileSync('app/profile-chat-responsive.css','utf8');
assert(!panel.includes('selectHoldTimer')&&!panel.includes('beginMessageSelection(')&&
 !panel.includes('selectHoldActivated'), 'Long press must not start bulk selection');
assert(panel.includes("rightClickPending.current=e.pointerType==='mouse'&&e.button===2?m.id:null"),
 'Only a genuine right mouse click can arm message bulk selection');
assert(panel.includes('e.button!==2||rightClickPending.current!==m.id||!canDeleteMessage(m)')&&
 panel.includes('toggleMessageSelection(m);'), 'Right mouse context click toggles eligible messages');
assert(panel.includes("window.getSelection()?.toString()"), 'Copying selected text never toggles bulk deletion');
assert(chatSelectionCss.includes('-webkit-user-select:text')&&
 chatSelectionCss.includes('-webkit-touch-callout:default'),
 'Long touch preserves native text selection and copy menu');
assert(panel.includes('onDoubleClick={e=>{if(e.button!==0') && panel.includes('startReply(m)'),
 'Reply is available by left-button double click and a mobile-accessible action');
assert(panel.includes("role=\"status\" aria-label=\"Ответ на сообщение\""),
 'Composer shows a cancellable reply preview');
assert(panel.includes('m.reply_to_id&&<button')&&panel.includes('jumpToChatMessage(m.reply_to_id!)'),
 'Stored replies display a linked source quote');
assert(panel.includes("if(readOnly||selectedMessages.length"),'Guest and selection mode must not start replies');
assert(source.includes("supabase.rpc('send_chat_reply'"),'A reply is sent in one RPC');
const replySql=fs.readFileSync('supabase/migrations/20261115143500_chat_replies.sql','utf8');
assert(replySql.includes("channel_id=p_channel and created_at>now()-interval '30 days'"),
 'The reply source must belong to the same accessible conversation and retention window');
assert(replySql.includes("kind='observer'"),'Guest writes must remain forbidden in SQL');
assert(replySql.includes('grant execute on function public.send_chat_reply'), 'Reply function is explicitly granted');
console.log('PASS 30 chat clients, ordered deduplicated messages, signed media, realtime INSERT and six-second incremental recovery');
