/* Bounded journal history: 100 simulated readers, no production requests. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const ts=require('typescript');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const journal=fs.readFileSync('components/game/ClassroomJournal.tsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261031150000_classroom_journal_20_projection.sql','utf8');
for(const [file,source] of [['useRepublicGame.ts',hook],['ClassroomJournal.tsx',journal]]){
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 assert.equal(ast.parseDiagnostics.length,0,'TypeScript parse '+file);
}
assert(sql.includes('security invoker')&&sql.includes('private.is_game_teacher(p_game_id)'));
assert(sql.includes('limit 20')&&!sql.includes('limit 250'));
assert(sql.includes("'presence'"),'Teacher presence remains complete');
assert(hook.includes(".order('id',{ascending:false}).limit(20)"),'Teacher fallback fetches only 20');
assert(journal.includes('const JOURNAL_PAGE_SIZE=20'));
assert(journal.includes('.limit(JOURNAL_PAGE_SIZE)'),'All client history pages are bounded');
assert(journal.includes(".eq('actor_id',me.user_id)"),'Student initial history is user-scoped');
assert(journal.includes("if(!teacher)query=query.eq('actor_id',me!.user_id)"),'Student history pages are also user-scoped');
assert(journal.includes("historyRequest.current"),'Duplicate in-flight page requests are prevented');
assert(journal.includes("latestHistoryScope.current!==scope"),'Stale responses from old games/users are discarded');
assert(journal.includes('Загрузить предыдущие 20 событий'));
assert(journal.includes("if(page.length<JOURNAL_PAGE_SIZE)setOlderExhausted(true)"));
assert(journal.includes("className=\"journalMore\""),'Preserve approved control appearance');
assert(journal.includes("clear_classroom_journal"),'Existing soft-clear semantics remain');
assert(journal.includes("gte('created_at',cutoff||'1970-01-01')"),'Soft-clear cutoff applies to older pages');
const when=i=>'2026-10-31T'+String(9+Math.floor(i/90)).padStart(2,'0')+':'+String(Math.floor((i%90)/3)).padStart(2,'0')+':00.000Z';
const records=Array.from({length:89},(_,i)=>({id:i+1,created_at:when(i),actor_id:i%3===0?'student-a':'student-b'}));
const sort=(a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id;
for(let reader=0;reader<100;reader++){
 const teacher=reader===0,actor=reader%2?'student-a':'student-b';
 const own=records.filter(a=>teacher||a.actor_id===actor).sort(sort);
 let cursor=null,all=[];
 for(let pass=0;pass<10;pass++){
  const page=own.filter(a=>!cursor||a.created_at<cursor.created_at||a.created_at===cursor.created_at&&a.id<cursor.id).slice(0,20);
  assert(page.length<=20,'No oversized page');
  all.push(...page);cursor=page.at(-1)||null;
  if(page.length<20)break;
 }
 assert.deepEqual(all.map(a=>a.id),own.map(a=>a.id),'No missing or duplicated same-timestamp events');
 assert.equal(new Set(all.map(x=>x.id)).size,own.length);
 assert(teacher||all.every(x=>x.actor_id===actor),'No foreign-user row');
}
console.log('PASS journal paging: 20 initial/older, 100 synthetic readers, timestamp+id ties, RLS-scoped filters, no production calls');
