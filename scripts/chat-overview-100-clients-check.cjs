/* Simulates 100 independently mounted real game hooks, using virtual time and
 * synthetic Supabase responses only. No production users, quotas or writes.
 */
const assert=require('node:assert/strict');
const {harness}=require('./republic-game-resilience-check.cjs');

async function run(){
 const clients=Array.from({length:100},(_,i)=>{
  const game=harness({effects:true});
  game.setUser('student-'+i);
  return game;
 });
 await Promise.all(clients.map(client=>client.settle()));
 const count=client=>client.stats().started['rpc:get_my_chat_overview']||0;
 const baseline=clients.map(count);
 try{
  for(let second=0;second<120;second++){
   const row={
    id:'shared-chat-'+second,game_id:'game-a',
    channel_id:'channel-b',text:'Сообщение',
    created_at:'2026-10-28T00:00:00Z'
   };
   for(const client of clients)client.emit('chat_messages',row,'INSERT');
   await Promise.all(clients.map(client=>client.advance(1000)));
  }
  const perClient=clients.map((client,i)=>count(client)-baseline[i]);
  const reads=perClient.reduce((a,b)=>a+b,0);
  const max=Math.max(...perClient),min=Math.min(...perClient);
  // 1.5-second old coalescing makes up to 80 reads per client/2 min.
  // Eight seconds bounds this at about 16 while chat delivery stays via Realtime.
  assert(max<=18,'Excess overview RPC for a bursty chat: '+max);
  assert(reads<=1800,'100 clients created too many overview queries: '+reads);
  assert(min>=10,'The unread overview must keep reconciling');
  console.log(JSON.stringify({
   status:'PASS',model:'100 independent real useRepublicGame hooks',
   virtualSeconds:120,sourceMessages:120,realtimeDeliveries:12000,
   overviewRpc:reads,minPerClient:min,maxPerClient:max,
   transport:'synthetic; no real database or HTTP traffic'
  },null,2));
 }finally{for(const client of clients)client.dispose()}
}
const watchdog=setTimeout(()=>{console.error('FAIL 100-client chat test timed out');process.exitCode=1},110000);
run().then(()=>clearTimeout(watchdog),err=>{clearTimeout(watchdog);console.error(err);process.exitCode=1});
