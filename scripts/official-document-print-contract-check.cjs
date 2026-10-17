/* Check official document normalization without altering the live game. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261017201000_official_meeting_document_titles.sql','utf8');
const paper=fs.readFileSync('components/game/DocumentPaper.tsx','utf8');
assert(paper.includes('<span>{officialInstitution}</span>{footerSlot}'),'Existing paper footer shows issuer');
assert(!paper.includes('Учебный документ деловой игры'),'Never print an educational-game disclaimer');
assert(sql.includes("v_title:='Повестка заседания '"),'New agendas use the existing official template');
assert(sql.includes("v_title:='Протокол заседания '"),'New minutes use the existing official template');
assert(sql.includes("v_subject,private.formal_meeting_institution_label(p_game_id,p_institution)"),'Future document issuer is nominative');
assert(sql.includes("AND d.metadata->>'institution_key'=m.institution_key"),'Legacy repair checks original meeting linkage');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec("create role anon;create role authenticated;create schema private;"+
   "create table institution_units(id uuid,game_id uuid,title text);"+
   "create table formal_documents(id uuid primary key,game_id uuid,stage_no int,doc_type text,title text,subject_label text,metadata jsonb);"+
   "create table institution_meeting_records(game_id uuid,institution_key text,agenda_document_id uuid,minutes_document_id uuid);");
  const start=sql.indexOf('CREATE OR REPLACE FUNCTION public.save_institution_meeting_document');
  const update=sql.indexOf('-- Repair ONLY');
  assert(start>0&&update>start);
  await db.exec(sql.slice(0,start));
  const game='10000000-0000-0000-0000-000000000001';
  const gd='20000000-0000-0000-0000-000000000001',ksrf='20000000-0000-0000-0000-000000000002';
  const custom='20000000-0000-0000-0000-000000000003';
  const unit='30000000-0000-0000-0000-000000000001';
  await db.query('insert into institution_units values($1,$2,$3)',[unit,game,'Комитет по государственному строительству']);
  const insert=async(id,docType,title,issuer,key,stage,linked=true)=>{
   await db.query('insert into formal_documents values($1,$2,$3,$4,$5,$6,$7)',[
    id,game,stage,docType,title,issuer,JSON.stringify({document_kind:linked?'institution_meeting_'+(docType==='meeting_agenda'?'agenda':'minutes'):'authored',institution_key:key})
   ]);
  };
  await insert(gd,'meeting_agenda','Повестка заседания Государственной Думы — этап 4','Государственная Дума','gd',4);
  await insert(ksrf,'meeting_agenda','Повестка заседания · ksrf · этап 3','ksrf','ksrf',3);
  await insert(custom,'meeting_agenda','Повестка заседания — этап 5','Правительство Российской Федерации','government',5,false);
  await db.query('insert into institution_meeting_records values($1,$2,$3,null)',[game,'gd',gd]);
  await db.query('insert into institution_meeting_records values($1,$2,$3,null)',[game,'ksrf',ksrf]);
  await db.exec(sql.slice(update));
  const docs=(await db.query('select * from formal_documents order by stage_no')).rows;
  const ksrfDoc=docs.find(x=>x.id===ksrf),gdDoc=docs.find(x=>x.id===gd),authored=docs.find(x=>x.id===custom);
  assert.equal(gdDoc.title,'Повестка заседания Государственной Думы Федерального Собрания Российской Федерации');
  assert.equal(gdDoc.subject_label,'Государственная Дума Федерального Собрания Российской Федерации');
  assert.equal(ksrfDoc.title,'Повестка заседания Координационного Совета Российской Федерации');
  assert.equal(ksrfDoc.subject_label,'Координационный Совет Российской Федерации');
  assert.equal(authored.title,'Повестка заседания — этап 5','Do not overwrite manually authored document titles in storage');
  assert.equal(gdDoc.stage_no,4,'Stage references remain in storage');
  assert.equal(ksrfDoc.stage_no,3,'Stage links remain unchanged');
  const label=(await db.query("select private.formal_meeting_institution_label($1,'unit:'||$2::text) as name",[game,unit])).rows[0].name;
  assert.equal(label,'Комитет по государственному строительству');
  console.log('PASS official document migration: exact linked agendas only, formal issuers, stage links preserved.');
 }finally{await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
