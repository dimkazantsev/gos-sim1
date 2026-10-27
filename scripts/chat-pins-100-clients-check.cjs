/* Actual game hook with 100 synthetic clients. No network or live database. */
const assert=require('node:assert/strict');
const {harness}=require('./republic-game-resilience-check.cjs');
async function main(){
 const clients=Array.from({length:100},(_,i)=>{const h=harness({effects:true});h.setUser('student-'+i);return h});
 try{
  await Promise.all(clients.map(h=>h.settle()));
  clients.forEach(h=>h.render().setChannelId('channel-a'));
  clients.slice(0,50).forEach(h=>h.render().setChatOpen(true));
  await Promise.all(clients.map(h=>h.settle()));
  assert(clients.every(h=>h.render().channelId==='channel-a'));
  const baseline=clients.map(h=>h.readCount('chat_pins'));
  for(let i=0;i<10;i++){
   clients.forEach(h=>h.emit('chat_pins',{id:'other-'+i,channel_id:'channel-b'},'INSERT'));
   await Promise.all(clients.map(h=>h.settle()));
  }
  const irrelevant=clients.reduce((sum,h,i)=>sum+h.readCount('chat_pins')-baseline[i],0);
  assert.equal(irrelevant,0,'Other channel pins must not force reads of the current channel');
  const active=clients.slice(0,50),closed=clients.slice(50);
  const pin={id:'pin-a',game_id:'game-a',channel_id:'channel-a',message_id:'message-1',pinned_by:'student-0',pinned_at:'2026-10-28T00:00:00Z'};
  clients.forEach(h=>h.fixture('chat_pins',[pin]));
  const before=clients.map(h=>h.readCount('chat_pins'));
  clients.forEach(h=>h.emit('chat_pins',pin,'INSERT'));
  await Promise.all(clients.map(h=>h.settle()));
  assert(active.every((h,i)=>h.readCount('chat_pins')>before[i]&&h.render().chatPins.some(x=>x.id==='pin-a')),'Open chat must show newly pinned messages');
  assert(closed.every((h,i)=>h.readCount('chat_pins')===before[i+50]),'Closed chat must not read pins');
  closed.forEach(h=>h.render().setChatOpen(true));
  await Promise.all(clients.map(h=>h.settle()));
  assert(closed.every(h=>h.render().chatPins.some(x=>x.id==='pin-a')),'Reopened chat must reconcile missed pins');
  const after=clients.map(h=>h.readCount('chat_pins'));
  clients.forEach(h=>{h.fixture('chat_pins',[]);h.callbacks('chat_pins').forEach(cb=>cb({eventType:'DELETE',new:{},old:{id:'pin-a'}}))});
  await Promise.all(clients.map(h=>h.settle()));
  assert(clients.every((h,i)=>h.readCount('chat_pins')>after[i]&&h.render().chatPins.length===0),'DELETE without channel in old row must still reconcile open chats');
  console.log(JSON.stringify({status:'PASS',clients:100,unrelatedPinEvents:1000,irrelevantReads:irrelevant,scope:'synthetic; no HTTP or database'}));
 }finally{clients.forEach(h=>h.dispose())}
}
main().catch(error=>{console.error(error);process.exitCode=1});
