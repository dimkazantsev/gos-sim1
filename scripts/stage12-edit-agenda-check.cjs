'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require('playwright-core');
const sql=fs.readFileSync('supabase/migrations/20261022152229_stage12_edit_agenda_text.sql','utf8');
const ui=fs.readFileSync('components/game/InstitutionRegistrationPanel.tsx','utf8');
const css=fs.readFileSync('app/2026-stage12-synced-agenda.css','utf8');
const a=sql.indexOf('CREATE OR REPLACE FUNCTION private.sync_duma_session_agenda_document');
const b=sql.indexOf('CREATE OR REPLACE FUNCTION public.edit_stage12_duma_agenda_text');
const c=sql.indexOf('REVOKE ALL ON FUNCTION public.edit_stage12_duma_agenda_text');
assert(a>=0&&b>a&&c>b,'Canonical and editor functions are in migration');
const sync=sql.slice(a,b);
const edit=sql.slice(b,c);
assert(ui.includes('Полный текст повестки')&&ui.includes("rpc('edit_stage12_duma_agenda_text'"),'Text editor invokes dedicated secure RPC');
assert(!ui.includes('moveAgendaQuestion')&&!ui.includes('stage12Order'),'No bill rearrangement in the form');
assert(sql.includes('p_expected_body')&&sql.includes('IS DISTINCT FROM p_expected_body'),'Protect concurrent edits');
assert(sql.includes('position(lower(d.registry_no) in lower(v_body))=0'),'Protect bill links');
assert(sql.includes('REVOKE ALL ON FUNCTION public.update_stage12_duma_agenda'),'Obsolete reordering endpoint disabled');
async function database(){
 const db=new PGlite();
 const game='10000000-0000-0000-0000-000000000001',person='30000000-0000-0000-0000-000000000001';
 const session='40000000-0000-0000-0000-000000000001';
 const id=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');
 try{
  await db.exec('CREATE SCHEMA private; CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;');
  await db.exec("CREATE TABLE private.actor(permitted boolean, teacher boolean, registered boolean);INSERT INTO private.actor VALUES(true,true,true);");
  await db.exec("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '30000000-0000-0000-0000-000000000001'::uuid $$;");
  await db.exec("CREATE FUNCTION private.can_manage_duma_session(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT permitted FROM private.actor LIMIT 1 $$;");
  await db.exec("CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT teacher FROM private.actor LIMIT 1 $$;");
  await db.exec("CREATE FUNCTION private.require_duma_stage_open(uuid,integer) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END;$$;");
  await db.exec("CREATE FUNCTION private.require_game_meeting_registration(uuid,uuid,integer,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT (SELECT registered FROM private.actor LIMIT 1) THEN RAISE EXCEPTION 'registration required';END IF;END;$$;");
  await db.exec("CREATE FUNCTION private.formal_workflow(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;");
  await db.exec('CREATE SEQUENCE public.formal_registry_seq;');
  await db.exec("CREATE TABLE public.duma_sessions(id uuid PRIMARY KEY,game_id uuid,stage_no integer,session_no integer,title text,scheduled_start timestamptz,scheduled_end timestamptz,status text,agenda_document_id uuid,created_by uuid,agenda_notes text NOT NULL DEFAULT '',agenda_text_override text);");
  await db.exec("CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,game_id uuid,title text,registry_no text,body_text text,status_code text,status_label text,current_owner_key text,updated_at timestamptz DEFAULT now());");
  await db.exec("CREATE TABLE public.duma_agenda_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,agenda_no integer,formal_document_id uuid,status text NOT NULL DEFAULT 'pending');");
  await db.exec("CREATE TABLE public.institution_meeting_records(game_id uuid,stage_no integer,institution_key text,agenda_document_id uuid,agenda_body text,agenda_prepared_by uuid,agenda_approved_at timestamptz,agenda_approved_by uuid,updated_at timestamptz DEFAULT now(),PRIMARY KEY(game_id,stage_no,institution_key));");
  await db.exec("CREATE TABLE public.formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,to_status text,to_owner text,note text);");
  await db.exec("CREATE TABLE public.game_events(game_id uuid,round_no integer,category text,severity text,title text,body text,created_by uuid);");
  await db.exec(sync);await db.exec(edit);
  await db.query("INSERT INTO public.formal_documents(id,game_id,title,registry_no,body_text,status_code,status_label,current_owner_key) VALUES($1,$2,'Повестка ГД №2','ГОС.ID-ПОВ-ГД-00200','', 'draft','Проект повестки','gd')",[id(9),game]);
  for(const n of [1,2,3])await db.query("INSERT INTO public.formal_documents(id,game_id,title,registry_no,status_code,status_label) VALUES($1,$2,$3,$4,'draft','Черновик')",[id(n),game,'Проект закона '+n,'ГОС.ID-ЗП-ФЗ-0'+n]);
  await db.query("INSERT INTO public.duma_sessions(id,game_id,stage_no,session_no,title,status,agenda_document_id,created_by) VALUES($1,$2,12,2,'Государственная Дума','draft',$3,$4)",[session,game,id(9),person]);
  for(const n of [1,2])await db.query('INSERT INTO public.duma_agenda_items(session_id,agenda_no,formal_document_id) VALUES($1,$2,$3)',[session,n,id(n)]);
  const latest=async()=> (await db.query('SELECT body_text FROM public.formal_documents WHERE id=$1',[id(9)])).rows[0].body_text;
  const mirror=async()=> (await db.query("SELECT * FROM public.institution_meeting_records WHERE game_id=$1",[game])).rows[0];
  await db.query('SELECT private.sync_duma_session_agenda_document($1)',[session]);
  const original=await latest();assert(original.includes('ГОС.ID-ЗП-ФЗ-01')&&original.includes('ГОС.ID-ЗП-ФЗ-02'));
  await db.query('UPDATE public.institution_meeting_records SET agenda_approved_at=now() WHERE game_id=$1',[game]);
  const edited=original.replace('ВОПРОСЫ ПОВЕСТКИ','ВОПРОСЫ ДЛЯ РАССМОТРЕНИЯ')+'\n\nВыступления депутатов: до пяти минут.';
  await db.query('SELECT public.edit_stage12_duma_agenda_text($1,$2,$3,NULL)',[session,edited,original]);
  assert.equal(await latest(),edited,'Full agenda text is edited verbatim, without changing bills');
  assert.equal((await mirror()).agenda_body,edited,'Registration and session share same edited text');
  assert.equal((await mirror()).agenda_approved_at,null,'Editing draft invalidates prior approval');
  const ids=(await db.query('SELECT formal_document_id FROM public.duma_agenda_items WHERE session_id=$1 ORDER BY agenda_no',[session])).rows.map(x=>x.formal_document_id);
  assert.deepEqual(ids,[id(1),id(2)],'Agenda package order and foreign keys unchanged');
  await assert.rejects(()=>db.query('SELECT public.edit_stage12_duma_agenda_text($1,$2,$3,NULL)',[session,edited+'Дополнение',original]),/обновилась/i,'Stale editor cannot overwrite');
  await assert.rejects(()=>db.query('SELECT public.edit_stage12_duma_agenda_text($1,$2,$3,NULL)',[session,edited.replace('ГОС.ID-ЗП-ФЗ-02','Удалено'),edited]),/реестровые номера/i,'Cannot silently remove bill registry numbers');
  await db.exec('UPDATE private.actor SET permitted=false');
  await assert.rejects(()=>db.query('SELECT public.edit_stage12_duma_agenda_text($1,$2,$3,NULL)',[session,edited+'Изменение',edited]),/полномочий/i,'No unauthorised edit');
  await db.exec('UPDATE private.actor SET permitted=true,teacher=false,registered=false');
  await db.query('SELECT public.edit_stage12_duma_agenda_text($1,$2,$3,NULL)',[session,edited+'\nНовая формулировка доклада.',edited]);
  assert((await latest()).includes('Новая формулировка доклада.'),'Chair edits draft before registration');
  await db.query('INSERT INTO public.duma_agenda_items(session_id,agenda_no,formal_document_id) VALUES($1,3,$2)',[session,id(3)]);
  await db.query('SELECT private.sync_duma_session_agenda_document($1)',[session]);
  const withThird=await latest();
  assert(withThird.includes('ГОС.ID-ЗП-ФЗ-03'),'Automatic new package remains visible after manual text edits');
  assert.equal(withThird.split('ГОС.ID-ЗП-ФЗ-03').length,2,'New package not duplicated');
  await db.query("UPDATE public.duma_sessions SET status='open' WHERE id=$1",[session]);
  await db.query('UPDATE public.institution_meeting_records SET agenda_approved_at=now() WHERE game_id=$1',[game]);
  await db.exec('UPDATE private.actor SET registered=true');
  await assert.rejects(()=>db.query('SELECT public.edit_stage12_duma_agenda_text($1,$2,$3,NULL)',[session,withThird+'\nЕщё текст.',withThird]),/основание/i);
  await db.exec('UPDATE private.actor SET registered=false');
  await assert.rejects(()=>db.query('SELECT public.edit_stage12_duma_agenda_text($1,$2,$3,$4)',[session,withThird+'\nЕщё текст.',withThird,'Уточнение председателя']),/registration required/);
  await db.exec('UPDATE private.actor SET registered=true');
  await db.query('SELECT public.edit_stage12_duma_agenda_text($1,$2,$3,$4)',[session,withThird+'\nЕщё текст.',withThird,'Уточнение председателя']);
  assert((await mirror()).agenda_approved_at!==null,'After opening approval remains');
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM public.game_events')).rows[0].n),1,'Reasoned correction recorded');
  await db.query("UPDATE public.duma_sessions SET status='closed' WHERE id=$1",[session]);
  await assert.rejects(()=>db.query('SELECT public.edit_stage12_duma_agenda_text($1,$2,$3,$4)',[session,withThird,withThird,'Уточнение председателя']),/недоступно/i);
  console.log('PASS: full text correction; no legislative mutation; autosync new bills; approval; roles; optimistic concurrency; post-open audit.');
 }finally{await db.close();}
}
async function responsive(){
 const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
 assert(chrome,'Chromium is required');
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const html='<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--gs-border:#d9e1f1;--gs-surface-soft:#f3f6fb;--gs-surface:#fff;--gs-ink:#203456;--gs-muted:#71829c;--gs-radius-sm:12px}*{box-sizing:border-box}body{margin:0;padding:12px}.civicRegistration{max-width:1170px;margin:auto}.civicMeetingDocuments{display:grid;gap:16px}'+css+'</style><main class="institutionRegistrationPanel civicRegistration"><div class="civicMeetingDocuments"><section class="civicAgendaSyncedPreview"><strong>Повестка</strong><pre>Текст повестки</pre></section><section class="civicAgendaEdit"><button>Корректировать повестку</button><div class="civicAgendaEditBody"><p>Редактирование текста повестки</p><label>Полный текст повестки<textarea class="civicAgendaTextEditor" rows="15">Законопроект с длинным названием и реквизитами</textarea></label><button>Сохранить текст повестки</button></div></section></div></main>';
  for(const width of [320,375,430,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:850}});
   await page.setContent(html);
   const data=await page.evaluate(()=>{
    const els=['.civicAgendaSyncedPreview','.civicAgendaEdit','.civicAgendaTextEditor'].map(s=>document.querySelector(s));
    return {scroll:document.documentElement.scrollWidth,edges:els.map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scroll:e.scrollWidth,client:e.clientWidth})),textarea:els[2].getBoundingClientRect().height};
   });
   assert(data.scroll<=width+1&&data.edges.every(e=>e.right<=width+1&&e.scroll<=e.client+2),'No horizontal overflow at '+width+': '+JSON.stringify(data));
   assert(Math.abs(data.edges[0].left-data.edges[1].left)<2,'Consistent edges at '+width);
   assert(data.textarea>=240,'Large enough full text editor at '+width);
   await page.close();
  }
  console.log('PASS: full agenda text editor at 320–1440 px.');
 }finally{await browser.close();}
}
(async()=>{await database();await responsive()})().catch(e=>{console.error(e);process.exitCode=1});
