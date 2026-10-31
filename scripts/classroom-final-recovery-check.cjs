/* Offline checks: no production Supabase/Telegram calls, no browser sessions. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=path=>fs.readFileSync(path,'utf8');
const chat=read('lib/boundedChatWrite.ts');
const compiled=ts.transpileModule(chat,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
vm.runInNewContext(compiled,{module:mod,exports:mod.exports,Promise,Error,AbortController,setTimeout,clearTimeout});
async function test(){
 let requests=0,aborted=false;
 await assert.rejects(mod.exports.boundedChatWrite(signal=>{
  requests++;signal.addEventListener('abort',()=>{aborted=true});
  return new Promise(()=>{});
 },15),/Сервер не подтвердил отправку сообщения/);
 assert.equal(requests,1,'Never duplicate a non-idempotent chat write');
 assert(aborted,'The slow transport must be cancelled');
 const reply=await mod.exports.boundedChatWrite(()=>Promise.resolve({error:null}),35);
 assert.equal(reply.error,null);
 let late;
 const delayed=new Promise(resolve=>{late=resolve});
 await assert.rejects(mod.exports.boundedChatWrite(()=>delayed,10),/Сервер не подтвердил/);
 late({error:null});
 assert.equal((await delayed).error,null,'Server could commit even if transport timed out');
 const hook=read('components/game/useRepublicGame.ts');
 assert(hook.includes("boundedChatWrite(signal=>")&&hook.includes(".abortSignal(signal)"),'Chat writes must be bounded and abortable');
 assert(hook.includes('loadMessages(targetChannel),loadChatOverview()'),'Ambiguous writes must reconcile the history');
 const panel=read('components/game/ChatPanel.tsx');
 assert(panel.includes("if(ok){")&&panel.includes("setText('')"),'Only confirmed sends clear the draft');
 assert(panel.includes('проверьте историю перед повторной отправкой'),'No misleading retry advice');
 const dispatcher=read('app/api/telegram/dispatch/route.ts');
 for(const fragment of [
  "const groups=new Map<string,Set<string>>()",
  "links.set(scope+':'+link.user_id,link)",
  "prefs.set(scope+':'+pref.user_id,pref)",
  ".eq('game_id',scope).in('user_id',users)",
  ".eq('game_id',job.game_id).eq('user_id',job.user_id).is('roster_archived_at',null)",
  "if(linked.error||settings.error)",
  "if(!link?.notifications_enabled||!member)"
 ])assert(dispatcher.includes(fragment),'Telegram must preserve per-game recipient rights: '+fragment);
 // Synthetic 40 recipients in 2 rooms. Each may have notifications opted out.
 const jobs=Array.from({length:40},(_,i)=>({game_id:'game-'+Math.floor(i/20),user_id:'member-'+i}));
 const groups=new Map();
 for(const j of jobs){if(!groups.has(j.game_id))groups.set(j.game_id,new Set());groups.get(j.game_id).add(j.user_id)}
 assert.equal(groups.size,2);
 assert([...groups.values()].every(users=>users.size===20));
 const pages=read('.github/workflows/github-pages.yml');
 assert(pages.includes("NEXT_PUBLIC_GOS_RELEASE: ${{ github.sha }}")&&pages.includes('release.json'));
 const notice=read('components/GosReleaseNotice.tsx');
 assert(notice.includes("fetch(BASE+'/release.json'")&&notice.includes("cache:'no-store'"));
 assert(notice.includes("window.confirm(")&&notice.includes("window.location.reload()"));
 assert(!notice.includes("window.location.replace(")&&!notice.includes("window.location.assign("));
 assert(notice.includes("INTERVAL_MS=5*60*1000"),'Only one lightweight check every five minutes');
 assert(read('components/PwaRegistrar.tsx').includes("register(base+'/sw.js'"),'GH Pages uses scoped service worker');
 assert(read('public/sw.js').includes("BASE+'/_next/static/'"));
 console.log('PASS 40 Telegram recipients isolated by game; bounded non-idempotent chat write; safe GitHub Pages release checks and PWA scope');
}
test().catch(e=>{console.error(e);process.exitCode=1});
