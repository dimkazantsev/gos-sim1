/* One existing private socket; 100 synthetic clients; no production I/O. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {harness}=require('./republic-game-resilience-check.cjs');
const sql=fs.readFileSync('supabase/migrations/20261106020000_party_scoped_realtime_delta.sql','utf8');
const code=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const changed=uuid(501),untouched=uuid(502);
const party=(id,support)=>({id,game_id:'game-a',name:id===changed?'Партия А':'Партия Б',
 support,created_at:'2026-10-01T00:00:00Z',logo_path:null});
const first=[party(changed,10),party(untouched,30)];
const second=[party(changed,22),party(untouched,30)];
assert(code.includes(".eq('game_id',gameId).in('id',ids)"),'Only changed party IDs are fetched');
assert(code.includes("partyDeltaNeedsFull.current=true"),'Incomplete events must fall back');
assert(code.includes("version!==partyDeltaVersion.current"),'Concurrent edits cannot apply stale snapshots');
assert(code.includes("setMessages(rows=>rows.map(row=>row.id===next.id"),'Chat edits patch RLS-validated row payloads');
assert(!/CREATE TRIGGER|cron\.schedule|CREATE TABLE|ALTER PUBLICATION/i.test(sql),'No new trigger, cron, table or replication feed');
assert(sql.includes("'gos-id-live:'||target_game::text,true"),'Use existing private game topic');
assert(sql.includes("'operation','DELETE'"),'Cross-game moves invalidate old game');
assert(sql.includes('REVOKE ALL ON FUNCTION private.broadcast_game_parties_invalidation()'),'Trigger not public');
async function pgCheck(){
 const db=new PGlite();
 try{
  await db.exec('CREATE SCHEMA private;CREATE SCHEMA realtime;');
  await db.exec('CREATE TABLE realtime.messages(topic text,event text,payload jsonb,is_private boolean);');
  await db.exec("CREATE FUNCTION realtime.send(data jsonb,ev text,room text,priv boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN INSERT INTO realtime.messages(topic,event,payload,is_private) VALUES(room,ev,data,priv);END$$;");
  await db.exec('CREATE TABLE public.game_parties(id uuid PRIMARY KEY,game_id uuid,name text);');
  await db.exec(sql);
  await db.exec("CREATE TRIGGER broadcast_game_parties_invalidation AFTER INSERT OR UPDATE OR DELETE ON public.game_parties FOR EACH ROW EXECUTE FUNCTION private.broadcast_game_parties_invalidation()");
  const game=uuid(900),otherGame=uuid(901);
  await db.query('INSERT INTO public.game_parties(id,game_id,name) VALUES($1,$2,$3)',[changed,game,'Секретное название']);
  await db.query('UPDATE public.game_parties SET name=$2 WHERE id=$1',[changed,'Изменённый секрет']);
  await db.query('UPDATE public.game_parties SET game_id=$2 WHERE id=$1',[changed,otherGame]);
  await db.query('DELETE FROM public.game_parties WHERE id=$1',[changed]);
  const rows=(await db.query('SELECT topic,event,payload,is_private FROM realtime.messages ORDER BY ctid')).rows;
  assert.equal(rows.length,5,'Insert/update/move to new and old game/delete preserve five signals');
  assert(rows.every(r=>r.is_private&&r.event==='game_parties_changed'),'Only private topic');
  assert.deepEqual(rows.map(r=>r.payload.operation),['INSERT','UPDATE','UPDATE','DELETE','DELETE']);
  assert(rows.every(r=>r.payload.party_id===changed&&r.payload.table==='game_parties'));
  assert(rows.every(r=>!JSON.stringify(r.payload).includes('секрет')),'No party details in payload');
  console.log('PASS: real PostgreSQL trigger SQL in PGlite, five ID-only private signals.');
 }finally{await db.close();}
}
async function clientChecks(){
 const clients=Array.from({length:100},(_,i)=>{
  const h=harness({effects:true});
  h.setUser('student-'+i);h.fixture('game_parties',first);return h;
 });
 try{
  await Promise.all(clients.map(async h=>{await h.settle();await h.render().refresh();await h.settle()}));
  const before=clients.map(h=>h.readCount('game_parties'));
  for(const h of clients){
   h.fixture('game_parties',second);
   for(let n=0;n<8;n++)h.broadcast('gos-id-live:game-a','game_parties_changed',
    {table:'game_parties',party_id:changed,operation:'UPDATE'});
  }
  await Promise.all(clients.map(h=>h.advance(4300)));
  for(let i=0;i<clients.length;i++){
   const h=clients[i],log=h.stats().queryLog.filter(q=>q.table==='game_parties');
   assert.equal(h.readCount('game_parties')-before[i],1,'Eight pulses -> one party read');
   assert.deepEqual(log.at(-1).ins.id,[changed],'Only changed party ID queried');
   assert.equal(log.at(-1).columns.includes('description'),false,'No editable party dossier on dashboard');
   assert.equal(h.render().parties.find(x=>x.id===changed)?.support,22);
   assert.equal(h.render().parties.find(x=>x.id===untouched)?.support,30);
   assert.equal(h.channelsInfo().length,1,'Existing socket is reused');
  }
  console.log('PASS: 100 clients × 8 party change pulses -> 100 scoped reads (not 800 full-list reads).');
 }finally{clients.forEach(h=>h.dispose());}
 const legacy=harness({effects:true});
 try{
  legacy.setUser('legacy');legacy.fixture('game_parties',first);
  await legacy.settle();await legacy.render().refresh();legacy.fixture('game_parties',second);
  const n=legacy.readCount('game_parties');
  legacy.broadcast('gos-id-live:game-a','game_parties_changed',{table:'game_parties'});
  await legacy.advance(4300);
  const last=legacy.stats().queryLog.filter(q=>q.table==='game_parties').at(-1);
  assert(legacy.readCount('game_parties')>n&&!last.ins.id,'Old table-only broadcast triggers safe full read');
 }finally{legacy.dispose();}
 const removed=harness({effects:true});
 try{
  removed.setUser('removal');removed.fixture('game_parties',first);
  await removed.settle();await removed.render().refresh();
  removed.fixture('game_parties',[party(untouched,30)]);
  removed.broadcast('gos-id-live:game-a','game_parties_changed',
   {table:'game_parties',party_id:changed,operation:'DELETE'});
  await removed.advance(4300);
  assert(!removed.render().parties.some(p=>p.id===changed),'Deleted ID removed from party list');
  assert(removed.render().parties.some(p=>p.id===untouched),'Other parties remain visible');
 }finally{removed.dispose();}
 const chat=harness({effects:true});
 try{
  const message={id:'edited',game_id:'game-a',channel_id:'channel-a',kind:'text',text:'Было',
   storage_path:null,created_at:'2026-10-26T00:00:00Z'};
  chat.fixture('chat_messages',[message]);
  await chat.settle();chat.render().setChatOpen(true);await chat.settle();
  assert(chat.render().messages.some(m=>m.id==='edited'),'Opened chat includes stored message');
  const before=chat.readCount('chat_messages');
  chat.emit('chat_messages',{...message,text:'Стало'},'UPDATE');
  await chat.settle();await chat.advance(4200);
  assert.equal(chat.readCount('chat_messages'),before,'RLS-authorised UPDATE requires no history HTTP read');
  assert.equal(chat.render().messages.find(m=>m.id==='edited')?.text,'Стало');
  chat.emit('chat_messages',{id:'edited',channel_id:'channel-a'},'UPDATE');
  await chat.advance(4200);
  assert(chat.readCount('chat_messages')>before,'Incomplete payload falls back to original bounded read');
  console.log('PASS: in-place chat edits, legacy events, deletes, and incomplete-event fallback.');
 }finally{chat.dispose();}
}
(async()=>{await pgCheck();await clientChecks()})().catch(error=>{console.error(error);process.exitCode=1;});
