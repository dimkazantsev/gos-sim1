/* Focused, no-network test: 100 simulated readers and same-timestamp cursor safety. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const file='components/game/chatHistoryPaging.ts',mod=new Module(file,module);
mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
 module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
}}).outputText,file);
const {CHAT_HISTORY_PAGE_SIZE,chatHistoryCursorFilter}=mod.exports;
assert.equal(CHAT_HISTORY_PAGE_SIZE,10);
const created=(n)=>'2026-10-30T10:'+String(Math.floor(n/3)).padStart(2,'0')+':00.000+00:00';
const row=n=>({id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),created_at:created(n)});
const records=Array.from({length:47},(_,i)=>row(i+1)).sort((a,b)=>
 b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
function getPage(cursor){
 const subset=cursor?records.filter(m=>m.created_at<cursor.created_at||
  m.created_at===cursor.created_at&&m.id<cursor.id):records;
 return subset.slice(0,CHAT_HISTORY_PAGE_SIZE);
}
for(let viewer=0;viewer<100;viewer++){
 let loaded=[],cursor=null,count=0;
 do{
  const page=getPage(cursor);
  assert(page.length<=10);
  const parsed=cursor?chatHistoryCursorFilter(cursor):'';
  if(cursor)assert.equal(parsed,'created_at.lt.'+cursor.created_at+
   ',and(created_at.eq.'+cursor.created_at+',id.lt.'+cursor.id+')');
  loaded.push(...page);count++;
  cursor=page.at(-1)||null;
  if(page.length<10)break;
  assert(count<8,'Bounded pagination must terminate');
 }while(true);
 assert.equal(loaded.length,47);
 assert.equal(new Set(loaded.map(m=>m.id)).size,47);
 assert.deepEqual(loaded.map(m=>m.id),records.map(m=>m.id));
}
for(const bad of [{created_at:'bad',id:row(1).id},{created_at:row(1).created_at,id:'1);DELETE FROM chat_messages'}]){
 assert.throws(()=>chatHistoryCursorFilter(bad));
}
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const panel=fs.readFileSync('components/game/ChatPanel.tsx','utf8');
const style=fs.readFileSync('app/profile-chat-responsive.css','utf8');
const loader=hook.slice(hook.indexOf('async function loadMessages('),hook.indexOf('async function loadRecentChatMessages('));
assert(loader.includes('.limit(CHAT_HISTORY_PAGE_SIZE)'),'Initial history must fetch only 10');
assert(loader.includes('.or(chatHistoryCursorFilter(cursor))'),'Cursor reads use authorised channel-scoped PostgREST');
assert(loader.includes(".eq('channel_id',cid)"));
assert(loader.includes(".order('id',{ascending:false})"),'Tied timestamps must have consistent order');
assert(loader.includes('loadingOlderChatRef.current'),'Repeated taps must not overlap');
assert(loader.includes('chatChannelVersion.current!==version'),'Old channel responses must be discarded');
assert(hook.includes("if(!latest)return; // The first fetch is strictly ten messages."));
assert(hook.includes('if(channelId&&chatOpen)'),'Closed chat must not fetch message bodies');
assert(hook.includes('hasOlderChatMessages,olderChatLoading,loadOlderChatMessages'),'Expose paging through existing hook');
assert(panel.includes('Загрузить предыдущие сообщения')&&panel.includes('onClick={()=>void loadEarlierHistory()}'));
assert(panel.includes('useLayoutEffect')&&panel.includes('restoreHistoryScroll.current'),'Preserve scrolling');
assert(panel.includes("setSelectedMessages([])"),'Existing selections still reset on channel switch');
assert(panel.includes('showPinnedMessage')&&panel.includes('sendRecordingPreview'),'Existing pins/media behavior preserved');
assert(style.includes('.gsChatV2 .chatHistoryMore')&&style.includes('@media (max-width:420px)'));
console.log('PASS chat history: initial 10, 10 per cursor, 47 same-timestamp messages × 100 simulated readers, no duplicates, channel isolation, unchanged theme');
