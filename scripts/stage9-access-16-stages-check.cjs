const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261021130140_activate_stage9_after_approved_structure.sql','utf8');
const stageSource=fs.readFileSync('components/game/stageWorkStatus.ts','utf8');
const stagesView=fs.readFileSync('components/game/StagesView.tsx','utf8');
const governance=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
const stageLogic=ts.transpileModule(stageSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleObject={exports:{}};
new Function('module','exports',stageLogic)(moduleObject,moduleObject.exports);
const {isStageWorkOpen}=moduleObject.exports;
assert.equal(typeof isStageWorkOpen,'function');
assert(stagesView.includes("get_my_stage_document_holds"),'Individual final-document debt remains enforced');
assert(stagesView.includes('Boolean(selectedHold)'), 'Opening a stage does not circumvent student document debt');
assert(governance.includes('disabled={viewer||ksrfSessionBlocked}'),'Existing stage workflow guard stays in place');
assert(sql.includes("stage_no=9")&&sql.includes("stage_no=8"),'Only Stage 9 opened following approved Stage 8');
assert(!sql.includes("stage_no IN (9,10,11"),'Do not unlock other future stages');
const gameId='52297def-d24d-4ba9-8049-5078b1b3bd45';
const deadline=new Date(Date.now()+60*60*1000).toISOString();
const game={id:gameId,status:'running',turn_open:true,turn_ends_at:deadline};
const stage=n=>({game_id:gameId,stage_no:n,status:n<=8?'completed':n===9?'open':'locked',deadline:n===8||n===9?deadline:null});
for(let n=1;n<=16;n++){
 const s=stage(n),expected=n===9;
 assert.equal(isStageWorkOpen(game,s),expected,'Stage '+n+' unexpectedly enabled/disabled');
 if(n===9){
  assert(!isStageWorkOpen({...game,turn_open:false},s),'Paused game is not unlocked');
  assert(!isStageWorkOpen(game,{...s,deadline:new Date(Date.now()-1000).toISOString()}),'Expired stage is not unlocked');
  assert(!isStageWorkOpen(game,{...s,game_id:'00000000-0000-4000-8000-000000000002'}),'Cross-game stage remains blocked');
 }
}
(async()=>{
 const db=new PGlite();
 try {
 await db.exec([
 'CREATE TABLE public.game_stages(id uuid PRIMARY KEY,game_id uuid,stage_no integer,status text,opened_at timestamptz,completed_at timestamptz,deadline timestamptz)',
 'CREATE TABLE public.government_structures(game_id uuid,status text,formal_document_id uuid)',
 'CREATE TABLE public.government_nominations(game_id uuid,stage_no integer,office_kind text,status text)',
 'CREATE TABLE public.games(id uuid,status text,turn_open boolean,turn_ends_at timestamptz,current_round integer)',
 'CREATE TABLE public.stage_deadline_rules(game_id uuid,stage_no integer,deadline_at timestamptz,updated_at timestamptz)',
 'CREATE TABLE public.audit_log(game_id uuid,actor_id uuid,action text,entity_type text,payload jsonb)'
 ].join(';')+';');
 const uid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
 await db.query("INSERT INTO public.games VALUES($1,'paused',false,null,8)",[gameId]);
 for(let i=1;i<=16;i++)
   await db.query('INSERT INTO public.game_stages(id,game_id,stage_no,status,deadline) VALUES($1,$2,$3,$4,$5)',[uid(i),gameId,i,i<=8?'completed':'locked',i===8?deadline:null]);
 await db.query('INSERT INTO public.stage_deadline_rules(game_id,stage_no) VALUES($1,9)',[gameId]);
 await assert.rejects(()=>db.exec(sql),/Prime Minister and approved formal structure required/);
 let nine=(await db.query('SELECT status FROM public.game_stages WHERE stage_no=9')).rows[0];
 assert.equal(nine.status,'locked');
 await db.query("INSERT INTO public.government_structures VALUES($1,'approved',$2)",[gameId,uid(21)]);
 await db.query("INSERT INTO public.government_nominations VALUES($1,8,'prime_minister','appointed')",[gameId]);
 await db.exec(sql);
 let stages=(await db.query('SELECT stage_no,status,deadline,opened_at FROM public.game_stages ORDER BY stage_no')).rows;
 assert.equal(stages.length,16);
 for(const s of stages)assert.equal(s.status,s.stage_no<=8?'completed':s.stage_no===9?'open':'locked','Unexpected unlock of stage '+s.stage_no);
 assert.equal(stages[7].status,'completed','Stage 8 must remain completed');
 assert(stages[8].opened_at,'Activation date recorded');
 assert.equal(stages[8].deadline.toISOString(),deadline);
 let g=(await db.query('SELECT current_round,status,turn_open,turn_ends_at FROM public.games WHERE id=$1',[gameId])).rows[0];
 assert.equal(g.current_round,9);
 assert.equal(g.status,'running');
 assert.equal(g.turn_open,true);
 assert.equal(g.turn_ends_at.toISOString(),deadline);
 const rules=(await db.query('SELECT deadline_at FROM public.stage_deadline_rules WHERE stage_no=9')).rows[0];
 assert.equal(rules.deadline_at.toISOString(),deadline);
 let history=(await db.query('SELECT action,actor_id,payload FROM public.audit_log')).rows;
 assert.equal(history.length,1);
 assert.equal(history[0].actor_id,null,'Do not impersonate a teacher');
 assert.equal(history[0].payload.preserves_student_document_holds,true);
 await db.exec(sql);
 history=(await db.query('SELECT action FROM public.audit_log')).rows;
 assert.equal(history.length,1,'Re-running migration must not create duplicate events');
 console.log('PASS: 16-stage access matrix, one-time guarded Stage 9 activation, inherited Stage 8 deadline, student document holds preserved, no future-stage unlocks, audited idempotence');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});