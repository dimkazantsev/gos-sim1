'use strict';
// Reuse three identities from the preceding local-only 100-JWT test.
// The actual production rule trigger and private Broadcast policy are loaded
// into the disposable stack. No real game, quota or production credential.
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const parsed=new URL(process.env.SUPABASE_URL||'');
assert(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)&&
 ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&
 !parsed.search&&!parsed.hash&&parsed.pathname==='/', 'Local-only private rule QA');
const anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(anon&&service&&process.env.GOS_PRIVATE_QA==='LOCAL-100','Disposable credentials required');
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(parsed.origin,service,opts);
const game='a7b00000-0000-4000-8000-000000000100';
const other='a7b00000-0000-4000-8000-000000000200';
const topic=id=>'gos-id-live:'+id;
const tables=['stage_deadline_rules','parliamentary_election_rules','regional_election_rules'];
const clients=[],rooms=[];
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
function data(result,label){
 if(result.error)throw Error(label+': '+result.error.message);
 return result.data;
}
async function preflight(){
 const marker=data(await admin.from('qa_blitz_disposable_guard').select('marker').maybeSingle(),'QA guard');
 assert.equal(marker?.marker,'gos-id-disposable-blitz-v1');
 const games=data(await admin.from('games').select('id'),'QA games');
 assert.deepEqual(games.map(row=>row.id).sort(),[game,other].sort(),'Only the preceding two disposable games may exist');
 for(const table of tables){
  const rows=data(await admin.from(table).select('id').limit(1),'Empty '+table);
  assert.equal(rows.length,0,'Rule fixtures must be empty');
 }
}
async function login(label,email){
 const client=createClient(parsed.origin,anon,opts);
 const item={label,client};clients.push(item);
 const {data:session,error}=await client.auth.signInWithPassword({email,password:'Gos-Private-QA-only-2026!'});
 if(error||!session.session?.access_token)throw Error('Local login failed for '+label);
 await client.realtime.setAuth(session.session.access_token);
 return item;
}
async function join(item,id,allow=true){
 const channel=item.client.channel(topic(id),{config:{private:true,broadcast:{ack:true}}});
 const room={label:item.label+':'+id,channel,received:[]};
 rooms.push(room);
 channel.on('broadcast',{event:'game_rules_changed'},msg=>room.received.push(msg.payload));
 const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Rule channel timeout '+room.label)),18000);
  channel.subscribe((status,error)=>{
   if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
    clearTimeout(timer);resolve({status,error});
   }
  });
 });
 if(allow)assert.equal(result.status,'SUBSCRIBED',room.label+': '+String(result.error?.message||result.status));
 else assert.notEqual(result.status,'SUBSCRIBED','Foreign JWT must not join the target room');
 return room;
}
async function change(table,action,targets,run){
 const before=rooms.map(room=>room.received.length);
 const rows=data(await run(),table+' '+action);
 assert.equal(rows.length,2,'Each SQL statement changes exactly two fixture rows');
 const deadline=Date.now()+14000;
 while(Date.now()<deadline&&!targets.every(room=>room.received.length>before[rooms.indexOf(room)]))await sleep(100);
 // One notification per changed game and statement, not one per changed row.
 // Non-target rooms must receive none. Also validate the complete payload.
 await sleep(350);
 for(let i=0;i<rooms.length;i++){
  const room=rooms[i],expected=targets.includes(room)?1:0;
  const messages=room.received.slice(before[i]);
  assert.equal(messages.length,expected,table+' '+action+' delivery count for '+room.label);
  if(expected)assert.deepEqual(messages[0],{table},'Only table metadata may be broadcast');
 }
}
async function main(){
 await preflight();
 const [student,teacher,foreign]=await Promise.all([
  login('student','gos-private-student-1@example.invalid'),
  login('teacher','gos-private-teacher-0@example.invalid'),
  login('foreign','gos-private-outsider-0@example.invalid')
 ]);
 const [s,t,f]=await Promise.all([join(student,game),join(teacher,game),join(foreign,other)]);
 const denied=await join(foreign,game,false);
 for(const table of tables){
  await change(table,'INSERT',[s,t],()=>admin.from(table).insert([{game_id:game,probe:1},{game_id:game,probe:1}]).select('id'));
  await change(table,'UPDATE',[s,t],()=>admin.from(table).update({probe:2}).eq('game_id',game).select('id'));
  await change(table,'DELETE',[s,t],()=>admin.from(table).delete().eq('game_id',game).select('id'));
 }
 // Positive control: the other room is really listening, not merely disconnected.
 await change(tables[0],'foreign INSERT',[f],()=>admin.from(tables[0]).insert([{game_id:other,probe:1},{game_id:other,probe:1}]).select('id'));
 await sleep(500);
 assert.equal(s.received.length,9);assert.equal(t.received.length,9);
 assert.equal(f.received.length,1);assert.equal(denied.received.length,0);
 console.log(JSON.stringify({status:'PASS',environment:'disposable local Supabase real JWT and private WebSocket',tables:3,statements:10,changedRows:20,authorizedReceipts:18,foreignOwnGameReceipts:1,foreignTargetReceipts:0,productionRequests:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
 const results=await Promise.allSettled(clients.map(async item=>{
  await item.client.removeAllChannels();
  const result=await item.client.auth.signOut({scope:'local'});
  if(result.error)throw result.error;
 }));
 if(results.some(result=>result.status==='rejected'))process.exitCode=1;
});
