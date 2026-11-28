'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const dir='content/events-v2-editorial';
const allowed=new Set(['key','trust','lawful','public_interest','authorized_roles','description','legal_basis','news','protects_role_interest','metric_effects','fiscal_effect']);
function compile(cases,registry,matrix){
 const r=new Map(registry.map(c=>[c.case_key,c])),m=new Map(matrix.map(c=>[c.case_key,c]));
 assert.equal(cases.length,330);assert.equal(new Set(cases.map(c=>c.case_key)).size,330);
 assert.equal(r.size,330);assert.equal(m.size,141);
 assert.equal(cases.reduce((n,c)=>n+c.decision_options.length,0),1660);
 return cases.map(c=>{
  const evidence=r.get(c.case_key),route=m.get(c.case_key);
  assert.ok(evidence&&evidence.audience===c.audience&&evidence.title===c.title,c.case_key);
  assert.equal(evidence.source_url??null,c.source_url??null,c.case_key);
  assert.ok(typeof c.original_situation==='string'&&c.original_situation.trim(),c.case_key);
  assert.equal(c.effect_plan.rules_version,2,c.case_key);
  const options=c.effect_plan.options.map((o,i)=>{
   assert.equal(o.key,'option_'+(i+1),c.case_key);assert.equal(typeof o.lawful,'boolean');
   return Object.fromEntries(Object.entries(o).filter(([k])=>allowed.has(k)));
  });
  assert.equal(options.length,c.decision_options.length);
  const effect_plan={rules_version:2,options};
  if(c.audience==='single'){
   assert.ok(route?.owner_approved&&route.best_option===c.effect_plan.best_option_key,c.case_key);
   assert.ok(options.find(o=>o.key===route.best_option)?.lawful,c.case_key);
   effect_plan.best_option_key=route.best_option;
  }else{assert.ok(!Object.hasOwn(c.effect_plan,'best_option_key'));assert.ok(options.every(o=>o.lawful));}
  return {case_key:c.case_key,title:c.title,category:c.category,audience:c.audience,situation:c.original_situation,
   decision_options:c.decision_options,effect_plan,source_url:c.source_url??null,source_note:c.source_note??null,
   verified:c.verified===true,editorial_status:c.editorial_status,legal_status:c.legal_review.status,
   activation_allowed:evidence.activation_allowed===true&&evidence.legal_status==='verified_current',
   competence_allowed:c.audience!=='single'||(route.activation_allowed===true&&route.runtime_review?.status==='verified_current')};
 });
}
function assertReleaseReady(p){
 assert.ok(p.every(c=>c.verified&&c.editorial_status==='approved'&&c.legal_status==='verified_current'&&c.activation_allowed&&c.competence_allowed),'V2 release blocked: legal, editorial or runtime competence gate');
}
const cases=fs.readdirSync(dir).filter(n=>/^(collective-|individual-).*\.json$/.test(n)).sort().flatMap(n=>JSON.parse(fs.readFileSync(dir+'/'+n,'utf8')).cases);
const register=JSON.parse(fs.readFileSync(dir+'/source-register.json','utf8')).cases;
const matrix=JSON.parse(fs.readFileSync('docs/EVENTS_V2_COMPETENCE_APPROVAL_CANDIDATE_2026-11-28.json','utf8')).cases;
const payload=compile(cases,register,matrix);
const blocked=payload.filter(c=>!(c.verified&&c.editorial_status==='approved'&&c.legal_status==='verified_current'&&c.activation_allowed&&c.competence_allowed)).length;
console.log(JSON.stringify({catalogueCases:payload.length,options:1660,blocked,editorialBytes:Buffer.byteLength(JSON.stringify(cases)),candidateBytes:Buffer.byteLength(JSON.stringify(payload))}));
if(process.argv.includes('--release'))assertReleaseReady(payload);
async function main(){
 const db=new PGlite(),id=n=>'23000000-0000-4000-8000-'+String(n).padStart(12,'0'),game=id(999),user=id(998);
 try{
  await db.exec(`
CREATE SCHEMA private; CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE private.authored_event_catalog(case_key text PRIMARY KEY,content jsonb NOT NULL);
CREATE TABLE public.event_cases(id uuid PRIMARY KEY,game_id uuid,case_key text,title text,category text,audience text,status text,situation text,decision_options jsonb,effect_plan jsonb,comic_scene jsonb,source_url text,source_note text,verified bool);
CREATE TABLE public.event_assignments(case_id uuid,game_id uuid,recipient_id uuid,stage_no int,status text);
CREATE TABLE public.event_decisions(case_id uuid);
CREATE TABLE public.event_case_outcomes(case_id uuid);
CREATE TABLE public.event_collaboration_invites(case_id uuid);
CREATE TABLE public.event_authority_evidence(case_id uuid);
CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
CREATE TABLE public.game_stages(game_id uuid,stage_no int,status text);
CREATE TABLE private.event_content_revisions(revision text,event_case_id uuid,snapshot jsonb,PRIMARY KEY(revision,event_case_id));
`);
  await db.exec(fs.readFileSync('supabase/changes/events_v2_catalog_candidate.sql','utf8'));
  // Entirely fictional fixture; no real legal gate is changed or accepted.
  const synthetic=payload.map((c,i)=>({case_key:'fixture-'+i,title:'Учебный тест '+i,category:'Тест',audience:c.audience,situation:'Новый тест',
   decision_options:c.decision_options.map((_,j)=>'Вариант '+j),
   effect_plan:{rules_version:2,...(c.audience==='single'?{best_option_key:'option_1'}:{}),options:c.decision_options.map((_,j)=>({key:'option_'+(j+1),lawful:true,trust:0}))},
   verified:true,editorial_status:'approved',legal_status:'verified_current',activation_allowed:true,competence_allowed:true,source_url:null,source_note:null}));
  await db.query("INSERT INTO private.authored_event_catalog SELECT x->>'case_key',jsonb_build_object('title',x->>'title','category',x->>'category','audience',x->>'audience','effect_plan','{}'::jsonb,'comic_scene',jsonb_build_object('scene_id','art'),'allowed_roles','[]'::jsonb,'seriousness','light') FROM jsonb_array_elements($1::jsonb) x",[JSON.stringify(synthetic)]);
  for(let n=0;n<9;n++){const c=synthetic[n];await db.query("INSERT INTO event_cases VALUES($1,$2,$3,$4,$5,$6,$7,'Старый тест','[]','{}','{\"scene_id\":\"art\"}',NULL,NULL,false)",[id(n+1),game,c.case_key,c.title,c.category,c.audience,n===8?'archived':'ready']);}
  await db.query("INSERT INTO game_members VALUES($1,$2,'student',NULL)",[game,user]);
  await db.query("INSERT INTO game_stages VALUES($1,1,'open'),($1,2,'closed')",[game]);
  for(const [n,stage] of [[2,1],[3,1],[4,2],[5,1]])await db.query("INSERT INTO event_assignments VALUES($1,$2,$3,$4,'pending')",[id(n),game,user,stage]);
  for(const [table,n] of [['event_decisions',5],['event_case_outcomes',6],['event_collaboration_invites',7],['event_authority_evidence',8]])await db.query('INSERT INTO '+table+' VALUES($1)',[id(n)]);
  const q=(p,ids)=>db.query('SELECT private.events_v2_apply_catalog_candidate($1::jsonb,$2::uuid[]) AS result',[JSON.stringify(p),ids]);
  const bad=synthetic.map((c,i)=>i===0?{...c,activation_allowed:false}:c);
  await assert.rejects(()=>q(bad,[]),/release blocked/);
  if(blocked>0)await assert.rejects(()=>q(payload,[]),/release blocked/);
  const before=(await db.query("SELECT id,to_jsonb(c) AS data FROM event_cases c WHERE id NOT IN ($1,$2) ORDER BY id",[id(1),id(2)])).rows;
  const result=await q(synthetic,[id(2),id(4),id(5)]);
  assert.deepEqual(result.rows[0].result,{catalogue:330,updated_instances:2});
  assert.deepEqual((await db.query("SELECT id,to_jsonb(c) AS data FROM event_cases c WHERE id NOT IN ($1,$2) ORDER BY id",[id(1),id(2)])).rows,before);
  assert.equal((await db.query("SELECT count(*)::int n FROM event_cases WHERE comic_scene->>'event_rules_version'='2' AND effect_plan->>'rules_version'='2' AND comic_scene->>'scene_id'='art'")).rows[0].n,2);
  assert.equal((await db.query("SELECT count(*)::int n FROM private.event_content_revisions")).rows[0].n,2);
  assert.equal((await db.query("SELECT count(*)::int n FROM private.authored_event_catalog WHERE content->'effect_plan'->>'rules_version'='2' AND content->'comic_scene'->>'event_rules_version'='2'")).rows[0].n,330);
  assert.equal((await db.query("SELECT has_function_privilege('authenticated','private.events_v2_apply_catalog_candidate(jsonb,uuid[])','EXECUTE') allowed")).rows[0].allowed,false);
  await assert.rejects(()=>q(synthetic,[]),/already been migrated/);
  console.log('PASS isolated SQL catalogue candidate: release denial, 330 synthetic templates, two safe instances, seven preserved, markers, snapshots, privilege, repeat denied');
 }finally{await db.close();}
}
main().catch(e=>{console.error(e.code??'ERROR',e.message,e.where??'');process.exitCode=1});
