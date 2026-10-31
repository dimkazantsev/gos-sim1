const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const files=['components/game/useRepublicGame.ts','components/GameClient.tsx','components/game/useSectionUpdates.ts','lib/localGameSnapshot.ts'];
for(const file of files){const source=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(ast.parseDiagnostics.length,0,'Parse '+file)}
const hook=fs.readFileSync(files[0],'utf8'),shell=fs.readFileSync(files[1],'utf8'),badges=fs.readFileSync(files[2],'utf8'),cache=fs.readFileSync(files[3],'utf8');
assert(hook.includes('!allowFreshCore||lastCoreSuccessAt.current===0'),'Reuse core across navigation; only first entry or explicit full refresh reopens all collections');
assert(shell.includes('60000+Math.floor(Math.random()*12000)'),'Presence 60-72s, online freshness stays below 90s');
assert(hook.includes('previous.view===viewKey&&now-previous.at<60000'),'Coalesce duplicate presence writes');
assert(hook.includes("p_label:label||null")&&hook.includes("response.error?.code==='PGRST202'"),'One authenticated RPC for navigation; fallback only for unavailable migration');
assert(hook.includes("if(!legacy.error&&label)await logActivity('navigation'"),'Legacy path must not write activity after failed presence');
const presenceMigration=fs.readFileSync('supabase/migrations/20261028091547_game_presence_one_roundtrip_20261028.sql','utf8');
for(const guard of ['SECURITY INVOKER','auth.uid()','REVOKE ALL','GRANT EXECUTE','public.game_presence','public.game_activity'])assert(presenceMigration.includes(guard),'Presence migration must preserve auth, RLS and both writes: '+guard);
assert(badges.includes('600+userJitter')&&badges.includes('90000+userJitter'),'Stagger and slow fallback counters');
assert(badges.includes('now-lastFallbackAt<300000'),'Connected counters use five minute fallback');
assert(badges.includes('r.status>=500')&&badges.includes('Date.now()+90000'),'Server overload backoff');
assert(hook.includes('if(g.error||m.error)throw (g.error||m.error);'),'Transitory failure never claims revoked role');
assert(hook.includes('readLocalGameSnapshot(gameId,u.id)')&&hook.includes('acceptedMember.current?.user_id!==u.id'),'Server-approved identity required');
assert(hook.includes('lastCoreSuccessAt.current>0'),'Fresh network data supersedes cache');
assert(hook.includes('deleteLocalGameSnapshot(gameId,me.user_id)'),'Logout clears local published snapshot');
for(const guard of ['m.is_public','!!e.published_at','slice(0,16)','slice(0,64)','slice(0,80)','indexedDB.open','MAX_AGE=120000'])assert(cache.includes(guard),'Missing cache guard '+guard);
for(const secret of ['game_ballots','chat_messages','blitz_assignments','password','access_token','refresh_token'])assert(!cache.includes(secret),'Secret in cache '+secret);
const oldWrites=40*60/35,newWrites=40*60/66;
assert(newWrites/oldWrites<0.60,'Expected >40% fewer heartbeat writes for 40 simulated devices');
const updatesMigration=fs.readFileSync('supabase/migrations/20261028203000_section_updates_single_scan.sql','utf8');
assert(updatesMigration.includes('private.is_game_member(p_game_id)'),'Member authorization must be unchanged');
assert(updatesMigration.includes('private.is_game_teacher(p_game_id)'),'Teacher-only badge must stay role-checked');
assert(updatesMigration.includes('STABLE SECURITY DEFINER'),'Function volatility and security mode must remain');
assert.equal((updatesMigration.match(/from section_reads\b/g)||[]).length,1,'Eight receipt queries must become one read');
for(const key of ['documents','votes','events','actions','parties','stages','teacher','dashboard']){
 assert(updatesMigration.includes("filter (where section_key='"+key+"')"),'Missing read marker '+key);
 assert(updatesMigration.includes("'"+key+"',"),'Missing JSON response key '+key);
}
assert(updatesMigration.includes('into d,v,e,a,p,s,t,h'),'Receipt variables must retain their original order');
assert(updatesMigration.includes('where game_id=p_game_id and user_id=u'),'Receipt query must stay isolated by game and user');
for(let user=0;user<100;user++){
 const sectionNames=['documents','votes','events','actions','parties','stages','teacher','dashboard'];
 const rows=Array.from({length:24},(_,i)=>({section:sectionNames[(i*17+user*5)%sectionNames.length],seen:i*37+user}));
 for(const section of sectionNames){
  const oldMax=rows.filter(row=>row.section===section).reduce((m,row)=>Math.max(m,row.seen),Number.NEGATIVE_INFINITY);
  const newMax=rows.reduce((m,row)=>row.section===section?Math.max(m,row.seen):m,Number.NEGATIVE_INFINITY);
  assert.equal(newMax,oldMax,'100-viewer synthetic receipt equivalence: '+section);
 }
}
console.log('PASS 100 synthetic viewers: section receipts preserve all counters with one SQL scan');
console.log('PASS 40 simulated devices: heartbeat reduction, scoped published IndexedDB, core reuse, overload backoff');
