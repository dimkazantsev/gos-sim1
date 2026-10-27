/* Real game hook under 100 isolated clients; synthetic Supabase and virtual time. */
const assert=require('node:assert/strict');
const {harness}=require('./republic-game-resilience-check.cjs');
const N=100;
async function main(){
 const clients=Array.from({length:N},(_,n)=>{const h=harness({effects:true});h.setUser('student-'+n);return h});
 try{
  await Promise.all(clients.map(h=>h.settle()));
  clients.forEach(h=>h.render().setChatOpen(true));
  await Promise.all(clients.map(h=>h.settle()));
  assert(clients.every(h=>h.render().channelId==='channel-a'),'The initial authorised channel must remain selected');
  const count=h=>h.readCount('chat_messages');
  let base=clients.map(count);
  for(let i=0;i<20;i++){
   for(const h of clients)h.emit('chat_messages',{
    id:'remote-'+i,channel_id:'channel-b',
    text:'External channel update',created_at:'2026-10-28T00:00:00Z'
   },'UPDATE');
   await Promise.all(clients.map(h=>h.settle()));
  }
  let remoteReads=clients.reduce((n,h,i)=>n+count(h)-base[i],0);
  assert.equal(remoteReads,0,'An UPDATE in another channel must not reload the visible channel: '+remoteReads);
  base=clients.map(count);
  clients.forEach(h=>{h.setRevision(2);h.emit('chat_messages',{
   id:'current-edit',channel_id:'channel-a',text:'Edited current message',created_at:'2026-10-28T00:00:00Z'
  },'UPDATE')});
  await Promise.all(clients.map(h=>h.settle()));
  assert(clients.every((h,i)=>count(h)>base[i]),'The actively open channel must still reconcile edits');
  clients.forEach(h=>h.render().setChatOpen(false));
  await Promise.all(clients.map(h=>h.settle()));
  base=clients.map(count);
  for(let i=0;i<20;i++){
   clients.forEach(h=>h.emit('chat_messages',{
    id:'closed-edit-'+i,channel_id:'channel-a',text:'Changed while closed',
    created_at:'2026-10-28T00:00:00Z'
   },'UPDATE'));
   await Promise.all(clients.map(h=>h.settle()));
  }
  let closedReads=clients.reduce((n,h,i)=>n+count(h)-base[i],0);
  assert.equal(closedReads,0,'Closed chats must not refetch their entire history: '+closedReads);
  base=clients.map(count);
  clients.forEach(h=>{h.setRevision(3);h.render().setChatOpen(true)});
  await Promise.all(clients.map(h=>h.settle()));
  assert(clients.every((h,i)=>count(h)>base[i]),'Reopening must reconcile the visible channel with server changes');
  console.log(JSON.stringify({status:'PASS',clients:N,unrelatedUpdateDeliveries:2000,closedUpdateDeliveries:2000,remoteReads,closedReads,reopened:100,transport:'synthetic; no production queries'},null,2));
 }finally{clients.forEach(h=>h.dispose())}
}
const watchdog=setTimeout(()=>{console.error('FAIL 100-client channel test exceeded its budget');process.exitCode=1},110000);
main().then(()=>clearTimeout(watchdog),error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1});
