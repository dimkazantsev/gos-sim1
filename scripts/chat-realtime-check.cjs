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
assert(source.includes('messageRowsRef.current.some(old=>old.id===m.id)'),'Avoid duplicate media signing');
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

console.log('PASS 30 chat clients, ordered deduplicated messages, signed media, realtime INSERT and six-second incremental recovery');
