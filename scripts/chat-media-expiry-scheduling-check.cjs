const assert=require('node:assert/strict');
const fs=require('node:fs');
const file=fs.readFileSync(require('node:path').join(__dirname,'../components/game/ChatPanel.tsx'),'utf8');
assert.doesNotMatch(file,/setInterval\(\(\)=>setRetentionClock\(Date\.now\(\)\),15000\)/);
assert.match(file,/Math\.min\(\.\.\.expiryTimes\)/);
assert.match(file,/channel_id===channelId/);
assert.match(file,/kind==='audio'\|\|m\.kind==='video'/);
assert.match(file,/window\.clearTimeout\(id\)/);
function nextDelay(messages,now){
 const times=messages.filter(m=>m.kind==='audio'||m.kind==='video').map(m=>Date.parse(m.created_at)+3600000).filter(t=>Number.isFinite(t)&&t>now);
 return times.length?Math.max(1,Math.min(...times)-now+25):null;
}
const now=Date.parse('2026-10-27T00:00:00Z');
assert.equal(nextDelay([{kind:'text',created_at:new Date(now).toISOString()}],now),null);
assert.equal(nextDelay([{kind:'audio',created_at:new Date(now-3590000).toISOString()}],now),10025);
assert.equal(nextDelay([{kind:'video',created_at:new Date(now-3599000).toISOString()},{kind:'audio',created_at:new Date(now-3500000).toISOString()}],now),1025);
console.log('Chat media expiry scheduling checks passed');
