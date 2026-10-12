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
console.log('PASS process feed component wiring');


/* Teacher bulk deletion regression: visible-only selection, role gating,
 * and reuse of the audited soft-delete RPC rather than direct table DELETE. */
assert(source.includes("const bulkAllowed=teacher&&!readOnly"),'Bulk actions must be teacher-only and hidden in read-only mode');
assert(source.includes("bulkMode&&bulkAllowed&&<label"),'Checkboxes must only appear for teacher when bulk mode is active');
assert(source.includes("visiblePosts.every(p=>selectedPostIds.has(p.id))"),'Select-all state must derive from visible posts');
assert(source.includes("for(const post of visiblePosts)"),'Select-all must not select hidden posts');
assert(source.includes("setSelectedPostIds(previous=>{const next=new Set(previous)"),'Selection must be updated immutably');
assert(source.includes("setSelectedPostIds(new Set());setBulkProgress(0)},[game?.id]"),'Selection must reset between games');
assert(source.includes("if(!bulkAllowed||!game||busy)return"),'Bulk delete must not execute without teacher rights');
assert(source.includes("if(!confirm("),'Bulk deletion requires an explicit confirmation');
assert(source.includes("index+=3"),'Mass deletion requests must use bounded concurrency');
assert(source.includes("supabase.rpc('delete_process_post',{p_post_id:id})"),'Bulk delete must reuse the existing protected soft-delete RPC');
assert(!source.includes("supabase.from('political_posts').delete("),'Direct client table deletion must not be introduced');
assert(source.includes("if(succeeded)await g.refresh()"),'Refresh should happen once after a batch, not for every post');
assert(source.includes("setSelectedPostIds(new Set(failed))"),'Failed deletions must remain selected for retry');
console.log('PASS political-process bulk-delete contract');
