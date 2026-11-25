/* Focused regression: political feed exposes ten posts at a time without
 * deleting records or changing their sorted order. No network/database. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.join(__dirname,'..');
const moduleFile=path.join(root,'components/game/politicalWallPaging.ts');
const compiled=ts.transpileModule(fs.readFileSync(moduleFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
new Function('exports','module','require',compiled)(mod.exports,mod,require);
const {POLITICAL_POST_BATCH_SIZE,visiblePoliticalPostCount,nextPoliticalPostCount}=mod.exports;
assert.equal(POLITICAL_POST_BATCH_SIZE,10);
for(const count of [0,1,9,10,11,20,25,101]){
 const posts=Array.from({length:count},(_,i)=>({id:'post-'+i,pinned:i===2}));
 let visible=visiblePoliticalPostCount(posts.length);
 assert.equal(visible,Math.min(count,10),'Initial window of '+count);
 const sequence=[visible];
 while(visible<count){const next=nextPoliticalPostCount(visible,count);assert(next>visible,'Pagination should advance');assert(next-visible<=10,'At most 10 more posts');visible=next;sequence.push(visible)}
 assert.equal(visible,count,'All filtered posts must be accessible');
 assert.equal(posts.length,count,'Posts must not be mutated or removed');
 assert.equal(visiblePoliticalPostCount(count,10),Math.min(count,10),'Collapse to ten');
 assert.deepEqual(posts.slice(0,10).map(p=>p.id),posts.slice(0,visiblePoliticalPostCount(count)).map(p=>p.id),'Original order must remain intact');
 console.log('PASS process feed '+count+' posts: '+sequence.join(' -> '));
}
assert.equal(visiblePoliticalPostCount(20,Number.NaN),10);
assert.equal(visiblePoliticalPostCount(11,-50),10);
const source=fs.readFileSync(path.join(root,'components/game/PoliticalWallView.tsx'),'utf8');
assert(source.includes('visiblePosts.map(p=>{'),'Post JSX must render only visible posts');
assert(!source.includes(':filtered.map(p=>{'),'Full filtered list must not mount all posts');
assert(source.includes('setVisiblePostCount(POLITICAL_POST_BATCH_SIZE),[game?.id,search,filterActor,filterType,filterStage]'),'Search, filter and game changes must collapse window');
assert(source.includes('nextPoliticalPostCount(current,filtered.length)'),'Show-more action must use capped window');
assert(source.includes('Показать ещё'),'Standard expand action must be visible');
assert(source.includes('Свернуть до 10'),'Collapse action must remain possible');
assert(source.includes('role="status"'),'Counter must announce displayed/total posts');
// Users who only read the feed must not trigger get_process_actors or its expensive role checks.
assert(source.includes('const [actorLookupActive,setActorLookupActive]=useState(false)'),
 'Actor catalog must stay inactive until the publication composer opens');
assert(source.includes('useGameTableSync(!readOnly&&actorLookupActive?game?.id:undefined'),
 'Readers and guests must not make the actor permissions RPC');
assert(source.includes('onToggle={event=>setActorLookupActive(event.currentTarget.open)}'),
 'Opening and closing the existing composer must gate actor refresh without design changes');
assert(source.includes("supabase.rpc('get_process_actors',{p_game_id:game.id})"),
 'Publisher selection still obtains the complete server-authorized actor list');
console.log('PASS actor catalog is loaded only while composing a publication');
console.log('PASS process feed component wiring');


/* Teacher bulk deletion regression: visible-only selection, role gating,
 * and reuse of the audited soft-delete RPC rather than direct table DELETE. */
assert(source.includes("const bulkAllowed=teacher&&!readOnly"),'Bulk actions must be teacher-only and hidden in read-only mode');
assert(source.includes("bulkMode&&bulkAllowed&&!storyPost&&<label"),'Story news is never bulk-selectable, even by the teacher');
assert(source.includes("selectablePosts.every(p=>selectedPostIds.has(p.id))"),'Select-all derives only from visible editable non-story posts');
assert(source.includes("for(const post of selectablePosts)"),'Select-all must exclude protected story news');
assert(source.includes("setSelectedPostIds(previous=>{const next=new Set(previous)"),'Selection must be updated immutably');
assert(source.includes("setSelectedPostIds(new Set());setBulkProgress(0);setLocallyRemovedIds(new Set())},[game?.id]"),'Selection and local deletion state must reset between games');
assert(source.includes("if(!bulkAllowed||!game||busy)return"),'Bulk delete must not execute without teacher rights');
assert(source.includes("if(!confirm("),'Bulk deletion requires an explicit confirmation');
assert(source.includes("index+=3"),'Mass deletion requests must use bounded concurrency');
assert(source.includes("supabase.rpc('delete_process_post',{p_post_id:id})"),'Bulk delete must reuse the existing protected soft-delete RPC');
assert(!source.includes("supabase.from('political_posts').delete("),'Direct client table deletion must not be introduced');
assert(source.includes("if(succeeded)await g.refresh()"),'Refresh should happen once after a batch, not for every post');
assert(source.includes("setSelectedPostIds(new Set(failed))"),'Failed deletions must remain selected for retry');
console.log('PASS political-process bulk-delete contract');


/* Offscreen political posts must not generate Storage signatures, comment
 * projections, polling or additional WebSocket subscriptions. */
const hook=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8');
const civic=fs.readFileSync(path.join(root,'components/game/CivicDiscussion.tsx'),'utf8');
assert(source.includes("postFeedRef=useRef<HTMLElement>(null)")&&
 source.includes("new IntersectionObserver(entries=>")&&
 source.includes("g.loadPoliticalMediaUrl(id)"),
 'Images and files are signed only as their post enters the viewport');
assert(source.includes("data-political-post-id={p.id}"),
 'Only mounted visible posts are tracked for viewport media requests');
assert(source.includes("src={m.url||undefined}")&&
 !source.includes("href={m.url||'#'}"),
 'Missing signed URLs must not load the page itself or jump to the top');
assert(hook.includes("async function loadPoliticalMediaUrl(mediaId:string)")&&
 hook.includes("activeViewRef.current!=='actions'")&&
 hook.includes("acceptedMember.current?.kind!==member.kind"),
 'Media signing must be scoped to the authorized game, view and role');
assert(!hook.includes("Promise.all(rows.filter(row=>row.storage_path).map(async row=>({"),
 'The initial political feed must not automatically sign all attached media');
assert(!hook.includes("const attachments=page.media.filter(row=>row.storage_path)"),
 'Older pages must not automatically sign every attachment');
assert(civic.includes("visible&&(kind==='document'||open)?g.game?.id:undefined"),
 'Post comment and reaction reads start only after opening the conversation');
assert(civic.includes("supabase.rpc('record_civic_view'"),
 'The established unique-view accounting remains intact');
assert(civic.includes("async function react(value:number)")&&
 civic.includes("current.mine===value?0:value"),
 'First like or dislike must load the actual reaction state before toggling');
console.log('PASS: process media and discussions are loaded only when needed');

assert(source.includes("!readOnly&&!storyPost&&<div className=\"wallPostActions\""),'Story news has no voting, NPA or metric manipulation controls');
assert(source.includes("!storyPost&&<CivicDiscussion"),'Story news does not mount per-post discussion projection or background queries');

/* Lightweight scroll-to-top contract: no data fetches or extra subscriptions. */
const processCss=fs.readFileSync(path.join(root,'app/2026-political-process.css'),'utf8');
assert(source.includes('const [showBackToTop,setShowBackToTop]=useState(false)'),
 'The button must remain hidden until the political feed is scrolled');
assert(source.includes('window.addEventListener(\'scroll\',onScroll,{passive:true})')&&
 source.includes('window.removeEventListener(\'scroll\',onScroll)'),
 'A passive, cleaned-up listener tracks scroll without a polling timer');
assert(source.includes('window.requestAnimationFrame(()=>{frame=0;update()})')&&
 source.includes('window.cancelAnimationFrame(frame)'),
 'Scroll updates are frame-coalesced and cancelled on unmount');
assert(source.includes('processTopRef.current?.scrollIntoView({behavior:reduceMotion?\'auto\':\'smooth\',block:\'start\'})'),
 'Click scrolls to the section start and respects reduced motion');
assert(source.includes('aria-label="Наверх — к началу политического процесса"')&&
 source.includes('{showBackToTop&&<button'),
 'An accessible floating button appears only below the threshold');
assert(processCss.includes('.simMain > .processScrollTop{')&&processCss.includes('position:fixed')&&
 source.includes('</div>{showBackToTop&&<button'),

 'Button stays fixed rather than moving with publication cards');
assert(processCss.includes('bottom:calc(96px + env(safe-area-inset-bottom,0px))'),
 'Mobile button clears the navigation dock and phone safe area');
assert(processCss.includes('.simMain.chatOpen > .processScrollTop'),
 'Desktop button moves away from the open chat panel');
assert(!source.includes("supabase.from('processScrollTop')"),'Scroll control must not use Supabase');
console.log('PASS Political Process fixed scroll-to-top, mobile dock, chat and reduced motion');


/* Run the actual political-wall single-flight wrapper without a database or browser.
 * Multiple Realtime invalidations must not multiply expensive RLS reads. */
async function singleFlightRegression(){
 const source=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8');
 const start=source.indexOf(' async function loadPoliticalWall(){');
 const end=source.indexOf(' async function loadPoliticalWallSnapshot(){',start);
 assert(start>=0&&end>start,'Real political-wall loader uses a scoped single-flight wrapper');
 const make=new Function('gameId','authUser','readEpoch','politicalFullMode','politicalWallFlight','alive','activeGameRef','loadPoliticalWallSnapshot',
  source.slice(start,end)+'\nreturn loadPoliticalWall;');
 const gameId='sample-game',authUser={current:'student'},readEpoch={current:1},politicalFullMode={current:false},politicalWallFlight={current:null},alive={current:true},activeGameRef={current:gameId};
 let requests=0;
 const pending=[];
 const snapshot=()=>new Promise(resolve=>{requests++;pending.push(resolve)});
 const refresh=make(gameId,authUser,readEpoch,politicalFullMode,politicalWallFlight,alive,activeGameRef,snapshot);
 const p1=refresh(),p2=refresh(),p3=refresh();
 for(let i=0;i<4;i++)await Promise.resolve();
 assert.equal(requests,1,'Simultaneous callers issue just one first-page RPC');
 refresh();refresh();pending.shift()();
 for(let i=0;i<6;i++)await Promise.resolve();
 assert.equal(requests,2,'Mutation invalidations during a pending read issue one follow-up RPC');
 pending.shift()();await Promise.all([p1,p2,p3]);
 assert.equal(politicalWallFlight.current,null,'Single-flight state resets after a completed read');
 authUser.current='another-student';
 const switched=refresh();for(let i=0;i<4;i++)await Promise.resolve();
 assert.equal(requests,3,'New authenticated scope has its own authorized request');
 pending.shift()();await switched;
 assert.equal(politicalWallFlight.current,null);
 console.log('PASS political feed: three simultaneous calls -> one read, dirty burst -> one trailing read, identity isolated');
}
singleFlightRegression().catch(error=>{console.error(error);process.exitCode=1});

// Execute the actual first-page media merge with loaded older pages.
{
 const start=hook.indexOf('    setPoliticalMedia(previous=>{',hook.indexOf(' async function loadPoliticalWallSnapshot(){'));
 const end=hook.indexOf('    setPostFormalLinks(',start);
 assert(start>=0&&end>start,'Political media merge must remain present');
 const run=new Function('setPoliticalMedia','previous','rows','politicalOlderLoaded','full',hook.slice(start,end));
 const merge=(previous,rows,older,full)=>{let result;run(fn=>{result=fn(previous)},previous,rows,{current:older},full);return result};
 const old=Array.from({length:600},(_,i)=>({id:'p'+i,storage_path:'path/'+i,url:'signed/'+i}));
 const page=Array.from({length:80},(_,i)=>({id:'p'+(560+i),storage_path:i===0?'changed':'path/'+(560+i),url:null}));
 const reference=(previous,rows,older,full)=>{
  const cache=new Map(previous.map(row=>[row.id,row]));
  const combined=older&&!full?[...previous.filter(row=>!rows.some(r=>r.id===row.id)),...rows]:rows;
  return combined.map(row=>{const old=cache.get(row.id);return {...row,url:old?.storage_path===row.storage_path?old.url||null:null}});
 };
 let visits=0;
 const track=rows=>rows.map(row=>({...row,get id(){visits++;return row.id}}));
 const actual=merge(track(old),track(page),true,false),measured=visits;
 assert.deepEqual(actual,reference(old,page,true,false),'Preserve older pages, current replacements and signed paths');
 assert(measured<=4*(old.length+page.length),'Media merge must be linear, not '+measured+' ID accesses');
 for(const [previous,rows,older,full] of [[old,page,false,false],[old,page,true,true],[old,[],true,false],[[],page,true,false],[old,[page[0],page[0]],true,false]]){
  assert.deepEqual(merge(previous,rows,older,full),reference(previous,rows,older,full));
 }
 console.log('PASS political media linear merge: '+measured+' ID accesses; signed URL retained only for unchanged storage path');
}
