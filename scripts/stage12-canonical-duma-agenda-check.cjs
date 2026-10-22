'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require('playwright-core');
const migration=fs.readFileSync('supabase/migrations/20261022133900_stage12_canonical_duma_agenda.sql','utf8');
const panel=fs.readFileSync('components/game/InstitutionRegistrationPanel.tsx','utf8');
const css=fs.readFileSync('app/2026-stage12-synced-agenda.css','utf8');
const layout=fs.readFileSync('app/layout.tsx','utf8');
const block=(from,to)=>{const a=migration.indexOf(from),b=to?migration.indexOf(to,a+from.length):migration.indexOf('-- Backfill',a);assert(a>=0&&b>a,'SQL function exists: '+from);return migration.slice(a,b);};
const sync=block('CREATE OR REPLACE FUNCTION private.sync_duma_session_agenda_document','CREATE OR REPLACE FUNCTION public.save_institution_meeting_document');
const save=block('CREATE OR REPLACE FUNCTION public.save_institution_meeting_document','CREATE OR REPLACE FUNCTION public.open_duma_session');
const open=block('CREATE OR REPLACE FUNCTION public.open_duma_session',null);
assert(sync.includes("s.stage_no=12")&&sync.includes("agenda_document_id=excluded.agenda_document_id"),'Uses the one existing formal document');
assert(sync.includes("s.status='draft'")&&sync.includes("agenda_approved_at=case"),'Reapproval is necessary only when the draft changes');
assert(save.includes("p_kind='agenda' and p_institution='gd' and p_stage_no=12"),'No second editable agenda can be written');
assert(open.includes('m.agenda_approved_at is not null'),'Meeting cannot begin without approved synced agenda');
assert(panel.includes('gdStage12CanonicalAgenda')&&panel.includes('civicAgendaSyncedPreview'),'Registration panel previews the same agenda');
assert(panel.includes('!gdStage12CanonicalAgenda&&(!agendaHasDocument||!hasSessionRegistrations)'),'Independent editor hidden for Stage 12 only');
assert(layout.includes("import './2026-stage12-synced-agenda.css';"),'Brand styling loaded');
const game='10000000-0000-0000-0000-000000000001';
const chair='30000000-0000-0000-0000-000000000001';
const id=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');
async function database(){
 const db=new PGlite();
 try{
  await db.exec("CREATE SCHEMA private; CREATE SCHEMA auth;");
  await db.exec("CREATE TABLE public.duma_sessions(id uuid PRIMARY KEY,game_id uuid,stage_no integer,session_no integer,title text,scheduled_start timestamptz,scheduled_end timestamptz,status text,agenda_document_id uuid,created_by uuid,opened_at timestamptz,chair_user_id uuid);");
  await db.exec("CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,game_id uuid,title text,registry_no text,body_text text,status_code text,status_label text,current_owner_key text,updated_at timestamptz DEFAULT now());");
  await db.exec("CREATE TABLE public.duma_agenda_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,agenda_no integer,formal_document_id uuid,status text NOT NULL DEFAULT 'pending');");
  await db.exec("CREATE TABLE public.institution_meeting_records(game_id uuid,stage_no integer,institution_key text,agenda_document_id uuid,agenda_body text,agenda_prepared_by uuid,agenda_approved_at timestamptz,agenda_approved_by uuid,updated_at timestamptz DEFAULT now(),PRIMARY KEY(game_id,stage_no,institution_key));");
  await db.exec("CREATE TABLE public.game_stages(game_id uuid,stage_no integer);");
  await db.exec("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '30000000-0000-0000-0000-000000000001'::uuid $$;");
  await db.exec("CREATE FUNCTION private.formal_workflow(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;");
  await db.exec("CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;");
  await db.exec("CREATE FUNCTION private.can_manage_duma_session(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;");
  await db.exec("CREATE FUNCTION private.require_duma_stage_open(uuid,integer) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;");
  await db.exec(sync);
  // Full save function can be created without triggering its unrelated codepaths.
  await db.exec(save);
  await db.exec(open);
  await db.query("INSERT INTO public.game_stages VALUES($1,12)",[game]);
  await db.query("INSERT INTO public.formal_documents(id,game_id,title,registry_no,body_text,status_code,status_label,current_owner_key) VALUES($1,$2,'Повестка ГД № 2','ГОС.ID-ПОВ-ГД-00001','Первоначальная повестка','draft','Проект повестки','gd')",[id(10),game]);
  for(const n of [1,2,3])await db.query("INSERT INTO public.formal_documents(id,game_id,title,registry_no,status_code,status_label) VALUES($1,$2,$3,$4,'draft','Черновик')",[id(n),game,'Законопроект '+n,'ГОС.ID-ЗП-'+n]);
  const session='40000000-0000-0000-0000-000000000001';
  await db.query("INSERT INTO public.duma_sessions(id,game_id,stage_no,session_no,title,status,agenda_document_id,created_by) VALUES($1,$2,12,2,'Заседание № 2','draft',$3,$4)",[session,game,id(10),chair]);
  await db.query("INSERT INTO public.duma_agenda_items(session_id,agenda_no,formal_document_id) VALUES($1,1,$2),($1,2,$3)",[session,id(1),id(2)]);
  await db.query('SELECT private.sync_duma_session_agenda_document($1)',[session]);
  const read=async()=> (await db.query("SELECT * FROM public.institution_meeting_records WHERE game_id=$1 AND stage_no=12 AND institution_key='gd'",[game])).rows[0];
  let row=await read();
  assert.equal(row.agenda_document_id,id(10),'Upper and lower agendas share the original document ID');
  assert(row.agenda_body.includes('Законопроект 1')&&row.agenda_body.includes('Законопроект 2'),'Auto-filled agenda includes two documents');
  await assert.rejects(()=>db.query('SELECT public.open_duma_session($1)',[session]),/утвердить/i,'Draft session cannot open without chair approval');
  await db.query("UPDATE public.institution_meeting_records SET agenda_approved_at=now(),agenda_approved_by=$1 WHERE game_id=$2",[chair,game]);
  await db.query('SELECT private.sync_duma_session_agenda_document($1)',[session]);
  assert((await read()).agenda_approved_at!==null,'Unchanged draft preserves approval');
  await db.query("INSERT INTO public.duma_agenda_items(session_id,agenda_no,formal_document_id) VALUES($1,3,$2)",[session,id(3)]);
  await db.query('SELECT private.sync_duma_session_agenda_document($1)',[session]);
  row=await read();
  assert.equal(row.agenda_approved_at,null,'New draft bill invalidates old approval');
  assert(row.agenda_body.includes('Законопроект 3'),'Added package appears upstairs');
  await assert.rejects(()=>db.query('SELECT public.save_institution_meeting_document($1,12,$2,$3,$4,NULL)',[game,'gd','agenda','Самостоятельная повестка, отличная от утверждённой']),/автоматически/i,'Second manual agenda is blocked server-side');
  await db.query("UPDATE public.institution_meeting_records SET agenda_approved_at=now(),agenda_approved_by=$1 WHERE game_id=$2",[chair,game]);
  await db.query("SELECT public.open_duma_session($1)",[session]);
  assert.equal((await db.query("SELECT status FROM public.duma_sessions WHERE id=$1",[session])).rows[0].status,'open','Approved agenda unlocks meeting');
  // Explicit chairman correction after opening updates the canonical agenda,
  // but does not require a second approval (the action is separately audited).
  await db.query("DELETE FROM public.duma_agenda_items WHERE session_id=$1 AND agenda_no=3",[session]);
  await db.query('SELECT private.sync_duma_session_agenda_document($1)',[session]);
  assert((await read()).agenda_approved_at!==null,'Approved status survives after-opening correction');
  assert(!(await read()).agenda_body.includes('Законопроект 3'),'Open correction is reflected in registration preview');
  await db.query("SELECT private.sync_duma_session_agenda_document($1)",[session]);
  assert.equal((await db.query("SELECT count(*)::integer n FROM public.institution_meeting_records WHERE game_id=$1",[game])).rows[0].n,1,'Idempotent mirror; no second record');
  console.log('PASS: one document, 2→3 questions, invalidates draft approval, chair open gate, post-open correction, rejects alternate edits.');
 }finally{await db.close()}
}
async function responsive(){
 const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
 assert(chrome,'Chromium required');
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const long='О внесении изменений в Федеральный закон о полномочиях Государственной Думы Федерального Собрания Российской Федерации';
  const html='<html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:12px}.institutionRegistrationPanel{max-width:1140px;margin:auto}:root{--gs-border:#d8e2f1;--gs-radius-sm:12px;--gs-surface-soft:#f5f7fb;--gs-ink:#192d50;--gs-ink-2:#425578}'+css+'</style></head><body><section class="institutionRegistrationPanel"><div class="civicAgendaSyncedPreview"><strong>Содержание повестки · Реестр НПА</strong><pre>'+Array.from({length:8},(_,i)=>i+1+'. '+long).join('\n\n')+'</pre></div></section></body></html>';
  for(const width of [320,390,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:850}});
   await page.setContent(html);
   const s=await page.evaluate(()=>{const el=document.querySelector('.civicAgendaSyncedPreview'),pre=el.querySelector('pre');return {body:document.documentElement.scrollWidth,content:el.scrollWidth,client:el.clientWidth,pre:pre.scrollWidth,preClient:pre.clientWidth,height:pre.clientHeight};});
   assert(s.body<=width+1&&s.content<=s.client+2&&s.pre<=s.preClient+2,'Overflow at '+width+': '+JSON.stringify(s));
   assert(s.height<=340,'Limit preview height at '+width);
   await page.close();
  }
  console.log('PASS: canonical preview fits desktop, tablet and narrow phones.');
 }finally{await browser.close()}
}
(async()=>{await database();await responsive()})().catch(e=>{console.error(e);process.exitCode=1});
