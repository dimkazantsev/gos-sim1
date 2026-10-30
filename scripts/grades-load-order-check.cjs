/* Test the actual GradesView load() with deliberately reordered replies.
   No credentials, Supabase network, writes or game data. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const source=fs.readFileSync('components/game/GradesView.tsx','utf8');
const parsed=ts.createSourceFile('GradesView.tsx',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
let loader;function find(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='loadPass')loader=node;ts.forEachChild(node,find);}find(parsed);
assert(loader,'Cannot locate GradesView loader');
const compiled=ts.transpileModule(loader.getText(parsed)+'\nexports.load=loadPass;',{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
function make(deps){
 const out={},env={supabase:deps.supabase,game:{id:'test-game'},teacher:deps.teacher,me:deps.me,authId:deps.authId,
  compact:false,loadScope:'scope',activeScope:deps.activeScope||{current:'scope'},loadRequest:deps.loadRequest,
  acceptedRowsScope:{current:''},acceptedDebriefScope:{current:''},publicScoresCallback:{current:deps.onPublicScores},
  readState:{controller:null},g:{setError:error=>{throw Error('Unexpected loader error: '+error);}},setRows:deps.setRows,setDebriefRows:deps.setDebriefRows,AbortSignal,AbortController,setTimeout,clearTimeout,exports:out};
 new Function(...Object.keys(env),compiled)(...Object.values(env));return out.load;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function pendingQuery(pending){return{select(){return this;},eq(){return this;},order(){return this;},range(){return this;},abortSignal(){return this;},then(resolve){return new Promise(done=>pending.push(value=>{resolve(value);done();}));}};}
(async()=>{
 {
  const pending=[],seen=[],loadRequest={current:0};
  const load=make({supabase:{from:()=>pendingQuery(pending)},teacher:true,me:{kind:'teacher',user_id:'owner'},authId:'owner',loadRequest,setRows:data=>seen.push(data),setDebriefRows:()=>{}});
  const first=load(),second=load();await tick();assert.equal(pending.length,2);
  pending[1]({error:null,data:[{id:'updated'}]});await second;
  pending[0]({error:null,data:[{id:'stale'}]});await first;
  assert.deepEqual(seen,[[{id:'updated'}]],'Out-of-order teacher grades must never overwrite newer scores');
 }
 {
  const publics=[],owns=[],debriefs=[],seen=[],debriefSeen=[],publicSeen=[],loadRequest={current:0};
  const supabase={rpc:()=>pendingQuery(publics),from:table=>pendingQuery(table==='stage_assessments'?owns:debriefs)};
  const load=make({supabase,teacher:false,me:{kind:'student',user_id:'u1'},authId:'u1',loadRequest,setRows:rows=>seen.push(rows),setDebriefRows:rows=>debriefSeen.push(rows),onPublicScores:rows=>publicSeen.push(rows)});
  const first=load(),second=load();await tick();assert.equal(publics.length,2);
  publics[1]({error:null,data:[{user_id:'u1',stage_no:1,auto_score:2,final_score:null,status:'draft',teacher_note:'must not leave loader'}]});await tick();
  assert.equal(owns.length,1);owns[0]({error:null,data:[{user_id:'u1',stage_no:1,id:'private-current',teacher_note:'owner only',status:'draft'}]});await tick();
  assert.equal(debriefs.length,1);debriefs[0]({error:null,data:[{id:'debrief-current'}]});await second;
  publics[0]({error:null,data:[{user_id:'u1',stage_no:1,auto_score:1,final_score:null,status:'draft'}]});await first;
  assert.equal(owns.length,1,'Stale request must not trigger another private read');
  assert.equal(seen.length,1,'Stale public grades cannot replace authenticated private results');assert.equal(seen[0][0].id,'private-current');
  assert.deepEqual(debriefSeen,[[{id:'debrief-current'}]]);assert.equal(publicSeen.length,1);assert.equal(publicSeen[0][0].teacher_note,undefined,'Parent receives public fields only');
 }
 {
  const pending=[],seen=[],activeScope={current:'scope'};
  const load=make({supabase:{from:()=>pendingQuery(pending)},teacher:true,me:{kind:'teacher',user_id:'owner'},authId:'owner',activeScope,loadRequest:{current:0},setRows:rows=>seen.push(rows),setDebriefRows:()=>{}});
  const request=load();await tick();activeScope.current='another-game-or-role';pending[0]({error:null,data:[{teacher_note:'private old scope'}]});await request;
  assert.equal(seen.length,0,'An old game or role cannot publish private data into the new scope');
 }
 assert(source.includes("useGameTableSync(authId===null?undefined:game?.id,['stage_assessments','stage_debriefs'],load,loadScope"),'Shared refresh must follow current account, game and role');
 assert(!source.includes("channel('grades-view:"),'Unpublished assessments must not create a useless channel');
 console.log('PASS assessment load: stale teacher/student/scope replies ignored; one public projection; scoped shared refresh');
})().catch(error=>{console.error(error);process.exitCode=1;});
