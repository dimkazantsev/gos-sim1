const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync('supabase/migrations/20261018103000_automatic_document_extension_fixed_scoring.sql','utf8');
const readFn=(fn)=>{
 const re=new RegExp('CREATE OR REPLACE FUNCTION '+fn.replace(/\./g,'\\.')+'\\([\\s\\S]*?\\$function\\$;','i');
 const found=source.match(re);assert(found,'Migration must contain '+fn);return found[0];
};
const uid=i=>'10000000-0000-0000-0000-'+String(i).padStart(12,'0');
const game=uid(1);
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE SCHEMA private;',
   'CREATE SCHEMA auth;',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $a$ SELECT '10000000-0000-0000-0000-000000000100'::uuid $a$;",
   'CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql STABLE AS $a$ SELECT true $a$;',
   'CREATE TABLE games(id uuid primary key,current_round integer,turn_open boolean,turn_ends_at timestamptz,status text,created_at timestamptz);',
   'CREATE TABLE game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz,opened_at timestamptz,completed_at timestamptz,score_closed_at timestamptz,primary key(game_id,stage_no));',
   'CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);',
   'CREATE TABLE stage_deadline_rules(game_id uuid,stage_no integer,deadline_at timestamptz,updated_at timestamptz);',
   'CREATE TABLE stage_assessments(game_id uuid,stage_no integer,user_id uuid,auto_score numeric,status text);',
   'CREATE TABLE official_docs(game_id uuid,stage_no integer,status text);',
   'CREATE TABLE stage_final_document_obligations(game_id uuid,stage_no integer,template_key text,user_id uuid,PRIMARY KEY(game_id,stage_no,template_key,user_id));',
   "CREATE FUNCTION private.capture_stage_document_obligations(uuid,integer) RETURNS void LANGUAGE plpgsql AS $a$ BEGIN INSERT INTO stage_final_document_obligations SELECT $1,$2,'gd_resolution',user_id FROM game_members WHERE game_id=$1 AND kind='student' ON CONFLICT DO NOTHING; END $a$;",
   "CREATE FUNCTION private.stage_document_debts(uuid,uuid,integer) RETURNS jsonb LANGUAGE sql STABLE AS $a$ SELECT CASE WHEN EXISTS(SELECT 1 FROM stage_final_document_obligations o WHERE o.game_id=$1 AND o.user_id=$2 AND o.stage_no=$3) AND NOT EXISTS(SELECT 1 FROM official_docs WHERE game_id=$1 AND stage_no=$3 AND status='published') THEN '[{\"template_key\":\"gd_resolution\",\"title\":\"Постановление\"}]'::jsonb ELSE '[]'::jsonb END $a$;"
   "CREATE FUNCTION private.stage_readiness_json(uuid,integer) RETURNS jsonb LANGUAGE sql STABLE AS $a$ SELECT jsonb_build_object('ready',EXISTS(SELECT 1 FROM official_docs WHERE game_id=$1 AND stage_no=$2 AND status='published')) $a$;",
   "CREATE FUNCTION private.compute_vsn_assessment(uuid,uuid,integer,text) RETURNS uuid LANGUAGE plpgsql AS $a$ BEGIN INSERT INTO stage_assessments(game_id,stage_no,user_id,auto_score,status) VALUES($1,$3,$2,2,'draft') ON CONFLICT DO NOTHING; RETURN gen_random_uuid(); END $a$;",
   'CREATE UNIQUE INDEX stage_assessments_fixture_unique ON stage_assessments(game_id,stage_no,user_id);'
  ].join('\n'));
  await db.exec(readFn('private.vsn_stage_window'));
  await db.exec(readFn('public.close_expired_game_stages'));
  await db.exec(readFn('private.has_prior_stage_document_hold'));
  await db.exec(readFn('public.get_my_stage_document_holds'));
  const start=new Date(Date.now()-3*60_000);
  await db.query("insert into games values($1,4,true,$2,'running',$3)",[game,start,start]);
  await db.query("insert into game_stages values($1,4,'open',$2,$3,null,null)",[game,start,new Date(Date.now()-60*60_000)]);
  await db.query('insert into stage_deadline_rules values($1,4,$2,$2)',[game,start]);
  for(let i=100;i<140;i++)await db.query("insert into game_members values($1,$2,'student',null)",[game,uid(i)]);
  const closed=await db.query('select public.close_expired_game_stages() n');
  assert.equal(Number(closed.rows[0].n),0,'Stage awaiting documents must remain open');
  let st=(await db.query('select * from game_stages where game_id=$1 and stage_no=4',[game])).rows[0];
  assert.equal(st.status,'open');
  assert.equal(new Date(st.score_closed_at).getTime(),start.getTime(),'Scoring cutoff is the original deadline');
  assert(new Date(st.deadline).getTime()>Date.now(),'Document work is extended automatically');
  assert.equal(Number((await db.query('select count(*) n from stage_assessments')).rows[0].n),40);
  assert.equal(Number((await db.query('select count(*) n from stage_final_document_obligations')).rows[0].n),40,'Outstanding responsibilities are captured on score closure');
  assert.equal((await db.query('select private.has_prior_stage_document_hold($1,$2,5) held',[game,uid(100)])).rows[0].held,true,'No bypass to the next stage');
  const holds=(await db.query('select public.get_my_stage_document_holds($1) debt',[game])).rows[0].debt;
  assert.equal(holds[0].penalty_points,0,'Unfinished open stage is not retroactively penalised');
  const window=(await db.query('select * from private.vsn_stage_window($1,4)',[game])).rows[0];
  assert.equal(new Date(window.end_at).getTime(),start.getTime(),'Score window stops at teacher deadline');
  const rule=(await db.query('select deadline_at from stage_deadline_rules where game_id=$1',[game])).rows[0];
  assert.equal(new Date(rule.deadline_at).getTime(),start.getTime(),'Automatic extension never moves teacher penalty deadline');
  await db.query('select public.close_expired_game_stages()');
  assert.equal(Number((await db.query('select count(*) n from stage_assessments')).rows[0].n),40,'Repeated scheduler runs are idempotent');
  await db.query("insert into official_docs values($1,4,'published')",[game]);
  await db.query("update game_stages set deadline=now()-interval '1 second' where game_id=$1 and stage_no=4",[game]);
  await db.query('select public.close_expired_game_stages()');
  st=(await db.query('select * from game_stages where game_id=$1 and stage_no=4',[game])).rows[0];
  assert.equal(st.status,'completed','Stage closes automatically after official paperwork');
  assert.equal((await db.query('select private.has_prior_stage_document_hold($1,$2,5) held',[game,uid(100)])).rows[0].held,false,'Next stage unlocks after publication');
  assert.equal(new Date(st.score_closed_at).getTime(),start.getTime(),'Completed stage never resets its scoring cutoff');
  assert.equal(Number((await db.query('select count(*) n from stage_assessments')).rows[0].n),40);
  assert(source.includes("'unpenalized_auto_score'"),'Persist earned gross score for safe refund');
  assert(source.includes("if v_existing.id is not null then return v_existing.id"),'Frozen evidence must not recalculate');
  assert(source.includes("a.status='draft'"),'Teacher-final grades must remain untouched by document refunds');
  console.log('PASS: 40 frozen scores, original scoring cutoff, independent automatic document extension, immutable teacher deadline, eventual completion.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});