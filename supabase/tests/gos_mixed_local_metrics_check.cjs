const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const runner=path.join(__dirname,'gos_40_mixed_local_20min.cjs');
const {localOrigin,validate,parseStudentCount,latencySummary}=require(runner);
assert.equal(parseStudentCount([]),40);
assert.equal(parseStudentCount(['--students=100']),100);
for(const value of ['0','41','101','100.5','NaN'])assert.throws(()=>parseStudentCount(['--students='+value]));
assert.throws(()=>parseStudentCount(['--students=40','--students=100']));
assert.throws(()=>parseStudentCount(['--students','100']));
assert.throws(()=>parseStudentCount(['--student=100']));
for(const url of ['https://example.supabase.co','http://localhost.example.com','http://user:pass@localhost:54321','http://localhost:54321/path'])assert.throws(()=>localOrigin(url));
const latency=latencySummary([{label:'read',ms:100},...Array.from({length:99},(_,i)=>({label:'read',ms:i+1}))]);
assert.deepEqual(latency.read,{n:100,p95_ms:95,p99_ms:99});
assert.deepEqual(latencySummary([{label:'write',ms:3},{label:'read',ms:8},{label:'write',ms:7}]),{write:{n:2,p95_ms:7,p99_ms:7},read:{n:1,p95_ms:8,p99_ms:8}});
function fixture(count){
 const students=Array.from({length:count},(_,i)=>({userId:String(i),email:`s${i}@example.invalid`}));
 const op={actor:'teacher',minute:0,rpc:'manage_game_stage',args:{},verify:{table:'games',match:{id:'x'},expect:{id:'x'}}};
 return {version:1,title:'LOCAL QA · test',gameId:'00000000-0000-4000-8000-000000000001',students,teacher:{userId:'t',email:'teacher@example.invalid'},observer:{userId:'o',email:'observer@example.invalid'},operations:{chat:students.map((_,actor)=>({...op,actor})),documents:[op],votes:[op],budget:[op],events:[op],blitz:[op],stages:[op]},negativeObserver:{rpc:'manage_game_stage',args:{p_game_id:'00000000-0000-4000-8000-000000000001'}}};
}
for(const count of [40,100]){
 assert.equal(validate(fixture(count),count).students.length,count);
 assert.throws(()=>validate(fixture(count),count===40?100:40));
 const invalid=fixture(count);invalid.operations.chat[0].actor=count;
 assert.throws(()=>validate(invalid,count));
}
const blocked=spawnSync(process.execPath,[runner,'--students=100'],{encoding:'utf8',env:{...process.env,SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'x',SUPABASE_SERVICE_ROLE_KEY:'x',QA_LOCAL_PASSWORD:'x',QA_MIXED_FIXTURE:'x'}});
assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/Only an isolated local Supabase is permitted/);
console.log('PASS: local-only 40/100 fixtures and p95/p99 nearest-rank; no network load.');
