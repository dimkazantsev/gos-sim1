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
assert(source.includes('setMessages(previous=>mergeChatMessages(previous,[row]))'),'Render incoming chat messages immediately');
assert(source.includes('void loadRecentChatMessages(channelRef.current)'),'Recover only current channel');
assert(source.includes('chatRecovery=setInterval(recoverVisibleChatAndBallots,6000)'),'Chat recovery must retain its exact six-second interval');
assert(source.includes('const startChatRecovery=setTimeout('),'The recovery timer must stagger the first tick without delaying future ticks');
assert(source.includes("else if(payload.eventType==='UPDATE')")&&source.includes('next.channel_id===channelRef.current'),'Handle UPDATE only for the selected channel or previously visible moved messages');
assert(source.includes('if(chat&&chatOpenRef.current&&channelRef.current)void loadMessages(channelRef.current)'),'Do not load hidden chat history on every edit');
assert(source.includes('if(chatOpen&&channelRef.current)void loadMessages(channelRef.current)'), 'Opening chat must recover edits that arrived while closed');
assert(source.includes('messageRowsRef.current.some(old=>old.id===m.id)'),'Avoid duplicate media signing');
assert(source.includes('void Promise.allSettled([loadMessages(targetChannel),loadChatOverview()])'),'Text sends must not wait for history readback');
console.log('PASS 30 chat clients, ordered deduplicated messages, signed media, realtime INSERT and six-second incremental recovery');
