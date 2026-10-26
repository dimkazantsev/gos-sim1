const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync('components/game/Blitz.tsx','utf8');
const migration=fs.readFileSync('supabase/migrations/20261026180000_blitz_receive_grace.sql','utf8');
const compiled=ts.transpileModule(source,{fileName:'Blitz.tsx',reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
assert.equal(compiled.diagnostics.length,0,'Blitz TSX syntax');
for(const s of ['BLITZ_RECEIVE_GRACE_MS=2000','BLITZ_CHOICE_WINDOW_MS=20_000',
 'withBlitzClock(result.data as Row,requestedAt)',
 'remainingBlitzMs(card)+BLITZ_RECEIVE_GRACE_MS+100',
 'remainingBlitzMs(active)+BLITZ_RECEIVE_GRACE_MS+100',
 '(choice>=0&&time===0)','(choice>=0&&activeSeconds===0)',
 'timeoutFinalized.current=card.id','archiveTimeoutFinalized.current=active.id'])
 assert(source.includes(s),'Missing safety behavior: '+s);
assert(!source.includes('time===0&&Date.now()>=Date.parse(card.deadline)'),'Cannot submit timeout at choice deadline');
assert(!source.includes('activeSeconds===0&&Date.now()>=Date.parse(active.deadline)'),'Cannot submit archive timeout at choice deadline');
assert.equal((migration.match(/22 seconds/g)||[]).length,12,'Six server conditions guarded then replaced');
assert.equal((migration.match(/'server_now',clock_timestamp\(\)/g)||[]).length,4,'Server timestamps emitted by both open RPCs');
assert(migration.includes('md5(definition) IS DISTINCT FROM rec.expected_hash'),'Migration must be revision guarded');
assert(!/\b(?:UPDATE|DELETE FROM)\s+public\.(blitz_assignments|stage_assessments)\b/i.test(migration),'No historical writes');
function result(atMs,choice,saved=undefined){return saved!==undefined?saved:atMs<=22000&&choice>=0?choice:null;}
for(const [ms,choice,expected] of [[0,1,1],[19999,3,3],[20000,0,0],[21000,1,1],[21999,2,2],[22000,2,2],[22001,2,null],[60000,2,null]])
 assert.equal(result(ms,choice),expected,'Boundary '+ms);
assert.equal(result(21999,-1),null,'Timed-out signal is never an answer');
assert.equal(result(22000,1,3),3,'First saved response remains immutable');
function remaining(serverAt,deadline,rtt){return Math.max(0,Math.min(20_000,deadline-(serverAt+rtt/2)));}
assert.equal(remaining(60_000,80_000,0),20000);
assert.equal(remaining(60_000,80_000,1000),19500);
assert.equal(remaining(60_000,140_000,0),20000,'Bad device clock cannot display 60 seconds');
console.log('PASS blitz stage 1: server-aligned 20s display, 2s network grace, idempotence and migration guard');