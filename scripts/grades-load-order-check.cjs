/* P1 Issue #415: test actual GradesView load() with deliberately reordered replies.
   No credentials, Supabase network, writes or game data. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync('components/game/GradesView.tsx','utf8');
const from=source.indexOf(' async function load(){'),to=source.indexOf(' useEffect(()=>{void supabase.auth.getUser()',from);
assert(from>=0&&to>from,'Cannot locate original GradesView loader');
const extract=source.slice(from,to);
const compiled=ts.transpileModule(extract+'\nexports.load=load;',{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const make=(deps)=>{
 const out={};
 new Function('supabase','game','teacher','me','authId','loadRequest','setRows','setDebriefRows','exports',compiled)(
 deps.supabase,{id:'test-game'},deps.teacher,deps.me,deps.authId,deps.loadRequest,deps.setRows,deps.setDebriefRows,out);
 return out.load;
};
(async()=>{
 {
  const pending=[],seen=[],loadRequest={current:0};
  const supabase={from:()=>({select:()=>({eq:()=>({order:()=>new Promise(resolve=>pending.push(resolve))})})})};
  const load=make({supabase,teacher:true,me:{kind:'teacher',user_id:'owner'},authId:'owner',loadRequest,setRows:data=>seen.push(data),setDebriefRows:()=>{}});
  const first=load(),second=load();
  assert.equal(pending.length,2);
  pending[1]({error:null,data:[{id:'updated'}]});await second;
  pending[0]({error:null,data:[{id:'stale'}]});await first;
  assert.deepEqual(seen,[[{id:'updated'}]],'Out-of-order teacher grades must never overwrite newer scores');
 }
 {
  const publics=[],owns=[],debriefs=[],seen=[],debriefSeen=[],loadRequest={current:0};
  const supabase={
   rpc:()=>new Promise(resolve=>publics.push(resolve)),
   from:table=>({select:()=>({eq:()=>({eq:()=>({order:()=>new Promise(resolve=>(table==='stage_assessments'?owns:debriefs).push(resolve))})})})})
  };
  const load=make({supabase,teacher:false,me:{kind:'student',user_id:'u1'},authId:'u1',loadRequest,setRows:rows=>seen.push(rows),setDebriefRows:rows=>debriefSeen.push(rows)});
  const first=load(),second=load();
  assert.equal(publics.length,2);
  publics[1]({error:null,data:[{user_id:'u1',stage_no:1,auto_score:2,final_score:null,status:'draft'}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(owns.length,1);
  owns[0]({error:null,data:[{user_id:'u1',stage_no:1,id:'private-current',teacher_note:'owner only',status:'draft'}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(debriefs.length,1);
  debriefs[0]({error:null,data:[{id:'debrief-current'}]});await second;
  publics[0]({error:null,data:[{user_id:'u1',stage_no:1,auto_score:1,final_score:null,status:'draft'}]});await first;
  assert.equal(owns.length,1,'Stale request must not trigger another private read');
  assert.equal(seen.length,1,'Stale public grades cannot replace authenticated private results');
  assert.equal(seen[0][0].id,'private-current');
  assert.deepEqual(debriefSeen,[[{id:'debrief-current'}]]);
 }
 assert(/\.subscribe\(\);\s*return\(\)=>\{void supabase\.removeChannel\(ch\)\}\s*\},\[game\?\.id,authId,teacher,me\?\.user_id\]\)/.test(source),
  'Realtime callback must use the current authenticated identity and role, not stale closure values');
 console.log('PASS P1 assessment load: stale teacher/student replies ignored; realtime subscription reflects current identity');
})().catch(error=>{console.error(error);process.exitCode=1});