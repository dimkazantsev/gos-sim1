'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const dumaSql=fs.readFileSync(path.join(root,'supabase/migrations/20261024023000_auto_signed_session_minutes.sql'),'utf8');
const meetingSql=fs.readFileSync(path.join(root,'supabase/migrations/20261024024000_auto_institution_minutes.sql'),'utf8');
const agenda=fs.readFileSync(path.join(root,'components/game/Stage12AgendaText.tsx'),'utf8');
const panel=fs.readFileSync(path.join(root,'components/game/InstitutionRegistrationPanel.tsx'),'utf8');
assert(agenda.includes('if(!editingRef.current)setText(next)'),'Live agenda must not overwrite typing');
assert(agenda.includes('loadedDocumentRef.current!==documentId'),'Background fetch must not unmount editor');
assert(panel.includes('dirtyMeetingDraftRef.current.agenda')&&panel.includes('dirtyMeetingDraftRef.current.stage12'),'Protect drafts during refresh');
assert(panel.includes("publish_institution_meeting_minutes_automatically"),'Protected meeting publication RPC');
assert(!panel.includes('Сохранить протокол как документ'),'No manual minutes entry');
assert(dumaSql.includes('DEFERRABLE INITIALLY DEFERRED'),'Record complete closed state once');
assert(meetingSql.includes('private.can_coordinate_stage_meeting'),'Maintain server-side signing authority');
const game='10000000-0000-0000-0000-000000000001',teacher='20000000-0000-0000-0000-000000000001',student='20000000-0000-0000-0000-000000000002';
const duma='30000000-0000-0000-0000-000000000001',government='30000000-0000-0000-0000-000000000002';
const q=async(db,sql,params=[])=> (await db.query(sql,params)).rows;
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE ROLE anon','CREATE ROLE authenticated','CREATE SCHEMA private','CREATE SCHEMA auth',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$",
   "CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT auth.uid() IN ('20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000002'::uuid)$$",
   "CREATE FUNCTION private.can_coordinate_stage_meeting(uuid,integer,text,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $4='20000000-0000-0000-0000-000000000001'::uuid$$",
   "CREATE FUNCTION private.formal_workflow(text) RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$",
   'CREATE SEQUENCE public.formal_registry_seq',
   'CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,game_id uuid,stage_no integer,registry_no text,title text,doc_type text,subject_key text,subject_label text,author_id uuid,body_text text,workflow_key text,workflow_steps jsonb,current_step integer,status_code text,status_label text,current_owner_key text,metadata jsonb,updated_at timestamptz DEFAULT now())',
   'CREATE TABLE public.formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,from_status text,to_status text,from_owner text,to_owner text,note text)',
   'CREATE TABLE public.duma_sessions(id uuid PRIMARY KEY,game_id uuid,stage_no integer,session_no integer,title text,status text,chair_user_id uuid,created_by uuid,opened_at timestamptz,closed_at timestamptz)',
   'CREATE TABLE public.government_sessions(id uuid PRIMARY KEY,game_id uuid,stage_no integer,session_no integer,title text,status text,chair_user_id uuid,created_by uuid,opened_at timestamptz,closed_at timestamptz)',
   'CREATE TABLE public.duma_agenda_items(id uuid,session_id uuid,game_id uuid,agenda_no integer,formal_document_id uuid,status text,result_note text)',
   'CREATE TABLE public.government_program_agenda(id uuid,session_id uuid,game_id uuid,agenda_no integer,program_id uuid,status text,result_note text,vote_id uuid)',
   'CREATE TABLE public.state_programs(id uuid,game_id uuid,title text)',
   'CREATE TABLE public.game_votes(id uuid,game_id uuid,stage_no integer,institution_key text,formal_document_id uuid,status text,title text,closed_at timestamptz,opened_at timestamptz,result_yes numeric,result_no numeric,result_abstain numeric,result_code text)',
   'CREATE TABLE public.institution_units(id uuid,game_id uuid,title text)',
   'CREATE TABLE public.institution_meeting_records(game_id uuid,stage_no integer,institution_key text,agenda_body text,agenda_approved_at timestamptz,minutes_document_id uuid,minutes_body text,minutes_prepared_by uuid,minutes_saved_at timestamptz,minutes_approved_by uuid,minutes_approved_at timestamptz,updated_at timestamptz,PRIMARY KEY(game_id,stage_no,institution_key))',
   'CREATE TABLE public.institution_session_registrations(game_id uuid,stage_no integer,institution_key text,user_id uuid)',
   "SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000001'"
  ].join(';')+';');
  await db.exec(dumaSql);
  await db.exec(meetingSql);
  await q(db,"INSERT INTO public.duma_sessions(id,game_id,stage_no,session_no,title,status,chair_user_id,created_by,opened_at) VALUES($1,$2,12,1,'Заседание Думы','open',$3,$3,now())",[duma,game,teacher]);
  const bill='40000000-0000-0000-0000-000000000001';
  await q(db,"INSERT INTO public.formal_documents(id,game_id,stage_no,title,doc_type,status_code) VALUES($1,$2,12,'Проект федерального закона','fz_bill','reading1')",[bill,game]);
  await q(db,"INSERT INTO public.duma_agenda_items(id,session_id,game_id,agenda_no,formal_document_id,status,result_note) VALUES(gen_random_uuid(),$1,$2,1,$3,'completed','После обсуждения закон одобрен')",[duma,game,bill]);
  await q(db,"UPDATE public.duma_sessions SET status='closed',closed_at=now() WHERE id=$1",[duma]);
  let rows=await q(db,"SELECT id,body_text,metadata,status_code FROM public.formal_documents WHERE metadata->>'automatic_session_id'=$1",[duma]);
  assert.equal(rows.length,1,'A closed Duma session creates one record');
  assert.equal(rows[0].status_code,'published');
  assert(rows[0].body_text.includes('После обсуждения закон одобрен'));
  assert(rows[0].body_text.includes('Личная электронная подпись'));
  assert.equal(rows[0].metadata.signed_name,'Система ГОС.ID');
  await q(db,"UPDATE public.duma_sessions SET status='closed' WHERE id=$1",[duma]);
  assert.equal((await q(db,"SELECT count(*)::int n FROM public.formal_documents WHERE metadata->>'automatic_session_id'=$1",[duma]))[0].n,1,'A repeat cannot produce duplicate minutes');
  await q(db,"INSERT INTO public.government_sessions(id,game_id,stage_no,session_no,title,status,chair_user_id,created_by) VALUES($1,$2,11,1,'Заседание Правительства','open',$3,$3)",[government,game,teacher]);
  await q(db,"UPDATE public.government_sessions SET status='closed',closed_at=now() WHERE id=$1",[government]);
  assert.equal((await q(db,"SELECT count(*)::int n FROM public.formal_documents WHERE metadata->>'automatic_session_id'=$1",[government]))[0].n,1);
  await q(db,"INSERT INTO public.institution_meeting_records(game_id,stage_no,institution_key,agenda_body,agenda_approved_at) VALUES($1,2,'ksrf','1. Обсуждение проекта',now())",[game]);
  await q(db,"INSERT INTO public.institution_session_registrations VALUES($1,2,'ksrf',$2)",[game,teacher]);
  await q(db,"INSERT INTO public.game_votes VALUES(gen_random_uuid(),$1,2,'ksrf',NULL,'closed','О принятии постановления',now(),now(),4,2,0,'passed')",[game]);
  const id=(await q(db,"SELECT public.publish_institution_meeting_minutes_automatically($1,2,'ksrf') id",[game]))[0].id;
  const doc=(await q(db,"SELECT body_text,metadata,status_code FROM public.formal_documents WHERE id=$1",[id]))[0];
  assert.equal(doc.status_code,'published');
  assert(doc.body_text.includes('за — 4'),'Results are in Russian');
  assert.equal(doc.metadata.signed_name,'Система ГОС.ID');
  assert.equal((await q(db,"SELECT public.publish_institution_meeting_minutes_automatically($1,2,'ksrf') id",[game]))[0].id,id,'Idempotent generic approval');
  await db.exec("SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';");
  await assert.rejects(()=>q(db,"SELECT public.publish_institution_meeting_minutes_automatically($1,2,'ksrf')",[game]),/уполномоченный председатель/i);
  await db.exec("SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';");
  await q(db,"INSERT INTO public.institution_meeting_records(game_id,stage_no,institution_key,agenda_body,agenda_approved_at) VALUES($1,3,'ksrf','Повестка нового заседания',now())",[game]);
  await q(db,"INSERT INTO public.institution_session_registrations VALUES($1,3,'ksrf',$2)",[game,teacher]);
  await q(db,"INSERT INTO public.game_votes(id,game_id,stage_no,institution_key,status) VALUES(gen_random_uuid(),$1,3,'ksrf','open')",[game]);
  await assert.rejects(()=>q(db,"SELECT public.publish_institution_meeting_minutes_automatically($1,3,'ksrf')",[game]),/открытые голосования/i);
  console.log('PASS: editor stability, Duma/Government minutes, Russian body, system attestation, no duplicates, role and vote guards');
 } finally {await db.close();}
})().catch(err=>{console.error(err);process.exitCode=1});
