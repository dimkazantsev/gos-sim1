/* No live network, test credentials, or production writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const batchSource=fs.readFileSync('components/game/signDocumentAssetBatch.ts','utf8');
const rlsFirst=fs.readFileSync('supabase/migrations/20261102122000_rls_auth_uid_statement_cache.sql','utf8');
const rlsSecond=fs.readFileSync('supabase/migrations/20261102124000_rls_jwt_auth_statement_cache.sql','utf8');
const broadcastSql=fs.readFileSync('supabase/migrations/20261102123000_duma_procedure_private_invalidation.sql','utf8');
const expectedTables=['duma_sessions','duma_agenda_items','institution_session_registrations','bill_amendments','bill_amendment_packs'];
for(const table of expectedTables){
 assert(broadcastSql.includes("'"+table+"'"),'Missing trigger for '+table);
 assert(source.includes("'"+table+"'"),'Missing live client invalidation for '+table);
 assert(!source.includes("table,filter:'game_id=eq.'+gameId},()=>notifyGameDataRefresh(gameId,table)"),'Old five subscriptions must be removed');
}
assert(source.includes("channel.on('broadcast',{event:'duma_procedure_changed'}"),'One private handler required');
assert(source.includes("if(typeof table==='string'&&dumaTables.has(table))notifyGameDataRefresh(gameId,table)"),'Only allowlisted table may dispatch');
assert(broadcastSql.includes("'gos-id-live:'||target_game::text"),'Game-scoped broadcast topic required');
assert(broadcastSql.includes("jsonb_build_object('table',tg_table_name)"),'Never broadcast row data');
assert(!broadcastSql.includes('realtime.broadcast_changes'),'No row leakage');
assert(source.includes('const PRESENCE_MIN_WRITE_INTERVAL_MS=20000'),'Presence writes must be coalesced');
assert(source.includes('const delay=Math.max(0,12000-(Date.now()-lastRealtimeOverviewAt.current))'),'Overview should be throttled');
assert(rlsFirst.includes("'auth.uid()','(select auth.uid())'"),'First RLS optimization preserves identity');
assert(rlsSecond.includes("'auth.jwt()','(select auth.jwt())'"),'JWT optimization preserves claims');
assert(!/drop policy|disable row level security/i.test(rlsFirst+rlsSecond),'Never weaken RLS');
function evalBatch(){
 const js=ts.transpileModule(batchSource,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText;
 const mod={exports:{}};
 const requireFake=p=>{
  if(p==='@/lib/resolveStoredAsset')return {resolveStoredAsset:(_bucket,path)=>({bucket:'game-assets',path})};
  throw Error('Unexpected import '+p);
 };
 new Function('module','exports','require',js)(mod,mod.exports,requireFake);
 return mod.exports.signDocumentAssetBatch;
}
async function storage(){
 const sign=evalBatch();
 let active=0,maxActive=0,calls=0;
 const rows=Array.from({length:20},(_,i)=>({id:String(i),path:'file-'+i}));
 const results=await sign(rows,{
  cached:()=>undefined,store:()=>{},isCurrent:()=>true,
  signMany:async()=>({data:null,error:new Error('Batch unavailable')}),
  signOne:async path=>{
   calls++;active++;maxActive=Math.max(maxActive,active);
   await Promise.resolve();await Promise.resolve();
   active--;return 'signed:'+path;
  }
 });
 assert.equal(calls,20,'Retain authorized individual fallback');
 assert(maxActive<=2&&maxActive>0,'Never run more than two Storage fallback requests');
 assert.deepEqual(results.map(v=>v.url),rows.map(v=>'signed:'+v.path),'Exact URL mapping');
 console.log('PASS: 20 Storage files: two concurrent fallbacks, all paths preserved');
}
async function broadcast(){
 const db=new PGlite();
 try{
  await db.exec(`create schema realtime;create table realtime.sent(payload jsonb,event text,topic text,is_private boolean);
   create function realtime.send(p jsonb,e text,t text,s boolean) returns void language plpgsql as $$
   begin insert into realtime.sent values(p,e,t,s);end;$$;`);
  for(const table of expectedTables)
   await db.exec('create table public.'+table+' (id uuid primary key default gen_random_uuid(),game_id uuid,payload text)');
  await db.exec(broadcastSql);
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  for(const table of expectedTables){
   await db.query('insert into public.'+table+' (game_id,payload) values($1,$2)',[a,'private-content']);
  }
  let sent=(await db.query('select payload,event,topic,is_private from realtime.sent order by event')).rows;
  assert.equal(sent.length,5);
  for(const [i,row] of sent.entries()){
   assert.equal(row.event,'duma_procedure_changed');assert.equal(row.topic,'gos-id-live:'+a);
   assert.equal(row.is_private,true);assert.deepEqual(Object.keys(row.payload),['table']);
   assert(expectedTables.includes(row.payload.table));
   assert(!JSON.stringify(row).includes('private-content'));
  }
  await db.query('update public.duma_sessions set game_id=$1 where game_id=$2',[b,a]);
  await db.query('delete from public.duma_sessions where game_id=$1',[b]);
  sent=(await db.query("select payload,topic from realtime.sent where payload->>'table'='duma_sessions' order by topic")).rows;
  assert.equal(sent.length,4,'Insert, dual game move and delete all notify');
  assert(sent.some(x=>x.topic==='gos-id-live:'+b));
  console.log('PASS: five Duma tables, private metadata only, scoped INSERT/UPDATE/DELETE and both-game invalidation');
 }finally{await db.close()}
}
storage().then(broadcast).catch(e=>{console.error(e);process.exitCode=1});
