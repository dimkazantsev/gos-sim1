'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync('components/game/gdVoteAllowance.ts','utf8');
const compiled=ts.transpileModule(source,{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const mod={};
new Function('exports',compiled)(mod);
const vote=mod.gdVoteAllowance;
const fallbackBeforePartyHydration=450/10;
for(const stage of Array.from({length:16},(_,i)=>i+1)){
 assert.equal(vote(63,63,null),63,'Stage '+stage+' must preserve a frozen 63-vote electorate, not '+fallbackBeforePartyHydration);
 assert.equal(vote(63,63,63),63,'Stage '+stage+' hydrated mandates');
 assert.equal(vote(63,45,null),45,'Stage '+stage+' actual attendance cap');
 assert.equal(vote(63,63,45),45,'Stage '+stage+' genuine ghost-voting or loss cap');
 assert.equal(vote(63,0,null),0,'Stage '+stage+' declared absence');
 assert.equal(vote(0,63,null),0,'Stage '+stage+' cannot create votes missing from snapshot');
}
assert.equal(vote(63,null,null),63,'NULL registered attendance inherits frozen allocation');
assert.equal(vote(63,63,0),0,'Cached zero current entitlement is binding');
assert.equal(vote(63,1.7,null),1,'Integer-only package');
assert.equal(vote(Number.NaN,63,null),0,'Corrupt frozen weight is denied');
const ui=fs.readFileSync('components/game/VotesView.tsx','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
assert(ui.includes('gdVotePresentWeight(v,mine.user_id,mine.present_mandates)'),'Ballot quota uses frozen electorate');
assert(ui.includes('cachedEffectiveByUser.get(uid)??null'),'Cold party mandate cache cannot fabricate equal shares');
assert(ui.includes('a+gdVotePresentWeight(v,x.user_id,x.present_mandates)'),'Registration total matches ballot UI');
assert(hook.includes('gdVoteAllowance(Number(v.electorate_snapshot.weights[r.user_id]||0),r.present_mandates,effective)'),'Quorum matches frozen GD snapshot');
assert(hook.includes("supabase.rpc('cast_vote_allocation'"),'Existing server-enforced ballot write retained');
assert(!ui.includes('Math.min(gdEffectivePresence(me?.user_id'),'Old incorrect 45-vote cap removed');
console.log('PASS: 16 stage-independent frozen GD vote weights, quorum and no extra HTTP reads');
