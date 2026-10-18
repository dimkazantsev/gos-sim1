const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261019184000_meeting_agenda_route_without_false_council_action.sql','utf8');
const ui=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
const match=migration.match(/CREATE OR REPLACE FUNCTION private\.normalize_institution_meeting_document_route\(\)[\s\S]*?\$fn\$;/);
assert(match,'Normalizer function must be in migration');
const tr=migration.match(/DROP TRIGGER IF EXISTS zzy_normalize_institution_meeting_document_route[\s\S]*?EXECUTE FUNCTION private\.normalize_institution_meeting_document_route\(\);/);
assert(tr,'Normalizer trigger must be in migration');
assert(migration.includes('public.advance_formal_document(uuid,text,text)'),'Generic advancement explicitly guarded');
assert(migration.includes('Повестка или протокол утверждается в разделе заседания'),'Legacy action blocked server-side');
assert(ui.includes('isMeetingProcedureDocument?null:')&&ui.includes('Документ утверждается в разделе заседания'),'UI does not show inaccessible Council action');
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');

(async()=>{
 const db=new PGlite(),game=uid(1);
 try{
  await db.exec([
   'CREATE SCHEMA private;',
   'CREATE TABLE formal_documents(id uuid PRIMARY KEY,game_id uuid,doc_type text,subject_key text,metadata jsonb,workflow_key text,workflow_steps jsonb,current_step integer,status_code text,status_label text,current_owner_key text,body_text text,registry_no text);'
  ].join('\n'));
  const legacy=JSON.stringify([
   {code:'draft',label:'Проект постановления ГД',owner:'author',action:'Внести в Совет ГД'},
   {code:'agenda',label:'В повестке Государственной Думы',owner:'gd_council',action:'Поставить на голосование'},
   {code:'adopted',label:'Принято Государственной Думой',owner:'gd_staff',action:'Оформить и опубликовать'},
   {code:'published',label:'Оформлено',owner:'system',action:null}
  ]);
  // Simulate original five published agenda documents BEFORE the new trigger.
  for(let i=0;i<5;i++) await db.query(
   "INSERT INTO formal_documents VALUES($1,$2,'meeting_agenda',$3,$4,'gd_resolution',$5,0,'published','Повестка утверждена','system','Текст неизменен',$6)",
   [uid(i+10),game,i===0?'ksrf':'gd',JSON.stringify({document_kind:i===4?'duma_session_agenda':'institution_meeting_agenda'}),legacy,'ГОС.ID-'+i]);
  const real=uid(100);
  await db.query(
   "INSERT INTO formal_documents VALUES($1,$2,'gd_resolution','gd','{}','gd_resolution',$3,0,'draft','Проект постановления ГД','author','Обычное постановление','ГОС.ID-100')",
   [real,game,legacy]);
  await db.exec(match[0]);await db.exec(tr[0]);
  // Backfill existing, already-published meeting documents without altering their actual status/content.
  await db.exec("UPDATE formal_documents SET current_step=current_step WHERE doc_type='meeting_agenda' AND status_code='published'");
  let rows=(await db.query("SELECT current_step,status_code,current_owner_key,workflow_steps,body_text,registry_no FROM formal_documents WHERE doc_type='meeting_agenda' ORDER BY id")).rows;
  assert.equal(rows.length,5);
  for(const r of rows){
   assert.equal(r.current_step,1,'Published agenda has completed final step');
   assert.equal(r.status_code,'published');
   assert.equal(r.current_owner_key,'system');
   assert.equal(r.workflow_steps.length,2);
   assert.equal(r.workflow_steps[0].action,null);
   assert.equal(r.workflow_steps[1].action,null);
   assert.equal(r.workflow_steps[1].label,'Повестка утверждена');
   assert.equal(r.body_text,'Текст неизменен');
  }
  const genuine=(await db.query('SELECT workflow_steps,current_step,current_owner_key FROM formal_documents WHERE id=$1',[real])).rows[0];
  assert.equal(genuine.current_step,0,'Real GD resolution stays in first workflow step');
  assert.equal(genuine.workflow_steps[0].action,'Внести в Совет ГД','Real resolution retains meaningful Council submission');
  assert.equal(genuine.current_owner_key,'author');
  // 40 simultaneous users/documents, no bogus submit action from new agenda records.
  for(let i=0;i<40;i++){
   const draft=i%2===0;
   await db.query(
    "INSERT INTO formal_documents VALUES($1,$2,'meeting_agenda','gd',$3,'gd_resolution',$4,0,$5,$6,$7,'Текст '||$8::text,$9)",
    [uid(200+i),game,JSON.stringify({document_kind:'institution_meeting_agenda'}),legacy,draft?'draft':'published',draft?'Проект повестки':'Повестка утверждена',draft?'gd':'system',i,'ГОС.ID-'+(200+i)]);
  }
  rows=(await db.query("SELECT status_code,current_step,workflow_steps FROM formal_documents WHERE doc_type='meeting_agenda'")).rows;
  assert.equal(rows.length,45);
  for(const x of rows){assert.equal(x.current_step,x.status_code==='published'?1:0);assert.equal(x.workflow_steps.length,2);assert(x.workflow_steps.every(step=>step.action===null))}
  await db.query("UPDATE formal_documents SET status_code='published',current_owner_key='system' WHERE id=$1",[uid(200)]);
  assert.equal((await db.query("SELECT current_step FROM formal_documents WHERE id=$1",[uid(200)])).rows[0].current_step,1);
  console.log('PASS: five historical and 40 new agendas; published 2/2, drafts 1/2; no false Council actions; real GD resolution remains actionable; unchanged document content.');
 }finally{await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
