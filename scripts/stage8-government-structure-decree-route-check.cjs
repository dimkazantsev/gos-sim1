const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261021123915_stage8_government_structure_presidential_act_route.sql','utf8');
const ui=fs.readFileSync('components/game/GovernmentFormationWorkspace.tsx','utf8');
assert(sql.includes('CREATE OR REPLACE FUNCTION public.review_government_structure'));
assert(sql.includes("v_body,'president_act',2,"),'Correct presidential document route');
assert(sql.includes("'president_decree','president','Президент Российской Федерации'"));
assert(!sql.includes("v_body,'president_decree',2,"));
assert(sql.includes("for update"),'Serialize review');
assert(sql.includes("if p_action not in ('approve','revision')"),'Retain action validation');
assert(ui.includes("onClick={()=>void reviewStructure('approve')}"));
assert(ui.includes("onClick={()=>void reviewStructure('revision')}"));
const game='10000000-0000-4000-8000-000000000001';
const president='20000000-0000-4000-8000-000000000001';
const stranger='20000000-0000-4000-8000-000000000002';
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE SCHEMA auth;CREATE SCHEMA private;',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.test_uid',true),'')::uuid $$;",
   "CREATE FUNCTION private.game_role(g uuid,u uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT CASE WHEN g='10000000-0000-4000-8000-000000000001'::uuid AND u='20000000-0000-4000-8000-000000000001'::uuid THEN 'президент' ELSE 'гость' END $$;",
   'CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;',
   'CREATE TABLE public.government_structures(game_id uuid PRIMARY KEY,status text,formal_document_id uuid,social_title text,economic_title text,defence_title text,foreign_title text,internal_title text,note text,reviewed_by uuid,reviewed_at timestamptz,updated_at timestamptz);',
   'CREATE TABLE public.institution_units(game_id uuid,unit_kind text,unit_key text,title text);',
   "CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,game_id uuid,title text,doc_type text,subject_key text,body_text text,workflow_key text,current_step int,metadata jsonb,CONSTRAINT decree_route CHECK(doc_type<>'president_decree' OR workflow_key='president_act'));",
   "CREATE FUNCTION private.stage8_create_formal_document(g uuid,title text,typ text,subj text,issuer text,body text,route text,step int,meta jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE doc uuid:=gen_random_uuid(); BEGIN INSERT INTO public.formal_documents VALUES(doc,g,title,typ,subj,body,route,step,meta);RETURN doc;END $$;"
  ].join('\n'));
  await db.exec(sql);
  await db.query("INSERT INTO public.government_structures(game_id,status,social_title,economic_title,foreign_title,defence_title,internal_title) VALUES($1,'submitted','Министерство социальной политики','Министерство экономики','Министерство иностранных дел','Министерство обороны','Министерство внутренних дел')",[game]);
  for(const unit of ['social','economic','foreign','defence','internal'])
   await db.query("INSERT INTO public.institution_units(game_id,unit_kind,unit_key,title) VALUES($1,'ministry',$2,'До утверждения')",[game,unit]);
  const actor=u=>db.query("SELECT set_config('app.test_uid',$1,false)",[u]);
  const decide=(action,note=null)=>db.query('SELECT public.review_government_structure($1,$2,$3)',[game,action,note]);
  await actor(stranger);
  await assert.rejects(()=>decide('approve'),/President \/ teacher access required/);
  let x=(await db.query('SELECT status FROM public.government_structures')).rows[0];
  assert.equal(x.status,'submitted');
  await actor(president);
  await assert.rejects(()=>decide('invalid'),/Unsupported structure decision/);
  await decide('revision','Переименовать министерство');
  x=(await db.query('SELECT status,note,formal_document_id FROM public.government_structures')).rows[0];
  assert.equal(x.status,'revision');
  assert.equal(x.note,'Переименовать министерство');
  assert.equal(x.formal_document_id,null);
  await db.query("UPDATE public.government_structures SET status='submitted'");
  await decide('approve');
  x=(await db.query('SELECT status,formal_document_id,reviewed_by FROM public.government_structures')).rows[0];
  assert.equal(x.status,'approved');
  assert.equal(x.reviewed_by,president);
  assert(x.formal_document_id);
  const docs=(await db.query('SELECT * FROM public.formal_documents')).rows;
  assert.equal(docs.length,1);
  assert.equal(docs[0].id,x.formal_document_id);
  assert.equal(docs[0].doc_type,'president_decree');
  assert.equal(docs[0].workflow_key,'president_act');
  assert.equal(docs[0].current_step,2);
  assert.equal(docs[0].metadata.purpose,'government_structure');
  assert.equal(docs[0].metadata.five_ministries,true);
  for(const title of ['Министерство социальной политики','Министерство экономики','Министерство иностранных дел','Министерство обороны','Министерство внутренних дел'])
   assert(docs[0].body_text.includes(title),'Decree must list '+title);
  const units=(await db.query('SELECT title FROM public.institution_units')).rows;
  assert.equal(units.length,5);
  assert(units.every(u=>u.title!=='До утверждения'),'Ministry titles propagated');
  await assert.rejects(()=>decide('approve'),/Submitted structure not found/);
  assert.equal((await db.query('SELECT count(*)::int count FROM public.formal_documents')).rows[0].count,1);
  console.log('PASS: Stage 8 presidential decree workflow, official document, ministry titles, revisions, permissions and duplicate prevention');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});