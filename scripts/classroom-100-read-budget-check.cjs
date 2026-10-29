/* Deterministic classroom read budget: no live Supabase requests. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const parse=ts.createSourceFile('useRepublicGame.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
assert.equal(parse.parseDiagnostics.length,0,'Game hook must parse without errors');
const ballot=source.match(/export function shouldReconcileOpenBallots\([^]*?\n\}/);
assert(ballot,'Time budget for open-ballot recovery must exist');
const compiled=ts.transpileModule(ballot[0],{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exported={};vm.runInNewContext(compiled,{exports:exported});
const reconcile=exported.shouldReconcileOpenBallots;
assert.equal(typeof reconcile,'function');
let studentQueries=0,teacherQueries=0;
for(let user=0;user<100;user++){
 let last=0;
 for(let t=6000;t<=60000;t+=6000){if(reconcile(t,last,'student',1)){studentQueries++;last=t;}}
}
let lastTeacher=0;
for(let t=6000;t<=60000;t+=6000){if(reconcile(t,lastTeacher,'teacher',1)){teacherQueries++;lastTeacher=t;}}
assert.equal(studentQueries,200,'100 student clients must not poll every six seconds');
assert.equal(teacherQueries,10,'Teacher retains six-second ballot feedback');
assert.equal(reconcile(60000,0,'student',0),false,'No open vote: no recovery');
assert.equal(reconcile(30000,0,'observer',1),true,'Observer still has ballot recovery');
assert(source.includes('shouldReconcileOpenBallots(now,lastBallotRecoveryAt,me.kind,openVotes.length)'), 'Runtime must use budget');
const start=source.indexOf(' async function loadRepublicOffices(');
const end=source.indexOf(' async function loadClassroomTelemetry(',start);
assert(start>=0&&end>start,'Office read function must be available');
const snippet=source.slice(start,end);
let clock=1000000,officeRequests=0;
const ctx={
 gameId:'game-1',authUser:{current:'student-1'},readEpoch:{current:3},
 officeReadState:{current:{scope:'',lastSuccessAt:0,inflight:null}},
 Date:{now:()=>clock},
 readSafely:async (_scopes,fn)=>fn({}),readCurrent:()=>true,
 requireSuccessful:([r])=>{if(r.error)throw r.error;},setOfficeRows:()=>{},
 supabase:{from:()=>{officeRequests++;return{select(){return this;},eq(){return this;},order(){return Promise.resolve({data:[],error:null});}}}}
};
vm.runInNewContext(ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+'\nthis.loadOffices=loadRepublicOffices;',ctx);
(async()=>{
 await Promise.all(Array.from({length:100},()=>ctx.loadOffices()));
 assert.equal(officeRequests,1,'Coalesce simultaneous office reads for the same game');
 await Promise.all(Array.from({length:100},()=>ctx.loadOffices()));
 assert.equal(officeRequests,1,'Reuse a fresh office read during view navigation');
 clock+=30001;await ctx.loadOffices();
 assert.equal(officeRequests,2,'Expired data must be reread');
 await ctx.loadOffices(true);
 assert.equal(officeRequests,3,'Manual refresh must bypass the cache');
 ctx.authUser.current='student-2';await ctx.loadOffices();
 assert.equal(officeRequests,4,'A different user must not reuse office data');
 console.log('PASS: 100 simulated students, 200 instead of 1000 ballot reads/min; office reads coalesced and isolated');
})().catch(error=>{console.error(error);process.exitCode=1});
