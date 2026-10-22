'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require('playwright-core');
const migration=fs.readFileSync('supabase/migrations/20261022141000_stage12_duma_agenda_edit.sql','utf8');
const panel=fs.readFileSync('components/game/InstitutionRegistrationPanel.tsx','utf8');
const lab=fs.readFileSync('components/game/LegislativeSessionLab.tsx','utf8');
const css=fs.readFileSync('app/2026-stage12-synced-agenda.css','utf8');
const functionSQL=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION private.sync_duma_session_agenda_document'),migration.indexOf('CREATE OR REPLACE FUNCTION public.update_stage12_duma_agenda'));
const editSQL=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.update_stage12_duma_agenda'),migration.indexOf('REVOKE ALL ON FUNCTION public.update_stage12_duma_agenda'));
assert(panel.includes("supabase.rpc('update_stage12_duma_agenda'"),'The upper panel saves via the secured RPC');
assert(panel.includes('moveAgendaQuestion(index,-1)')&&panel.includes('moveAgendaQuestion(index,1)'),'Chair can rearrange the agenda');
assert(panel.includes("p_order:stage12Session.status==='draft'?stage12Order.map(item=>item.id):null"),'Opened meeting never reorders questions');
assert(css.includes('margin:0 20px')&&css.includes('margin-left:14px'),'Preview/editor and buttons share consistent margins');
const create=lab.indexOf('{canManage&&<details className="legislativeCreate legislativeCreateWide">');
const tabs=lab.indexOf("<div className={'legislativeSessionTabs legislativeSessionTabsFull '+layout.tabs}>");
assert(create>=0&&tabs>create,'Meeting creation precedes existing meetings');
const game='10000000-0000-0000-0000-000000000001';
const session='40000000-0000-0000-0000-000000000001';
const uid='30000000-0000-0000-0000-000000000001';
const doc=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');
const item=n=>'50000000-0000-0000-0000-'+String(n).padStart(12,'0');
async function dbCheck(){
 const db=new PGlite();
 try{
  await db.exec("CREATE SCHEMA private;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;");
  await db.exec("CREATE SEQUENCE public.formal_registry_seq;");
  await db.exec("CREATE TABLE private.caller(permitted boolean,teacher boolean,attended boolean);INSERT INTO private.caller VALUES(true,true,true);");
  await db.exec("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '30000000-0000-0000-0000-000000000001'::uuid $$;");
  await db.exec("CREATE FUNCTION private.can_manage_duma_session(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT permitted FROM private.caller LIMIT 1 $$;");
  await db.exec("CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT teacher FROM private.caller LIMIT 1 $$;");
  await db.exec("CREATE FUNCTION private.require_duma_stage_open(uuid,integer) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END;$$;");
  await db.exec("CREATE FUNCTION private.require_game_meeting_registration(uuid,uuid,integer,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT (SELECT attended FROM private.caller LIMIT 1) THEN RAISE EXCEPTION 'registration required';END IF;END;$$;");
  await db.exec("CREATE FUNCTION private.formal_workflow(text) RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$;");
  await db.exec("CREATE TABLE public.duma_sessions(id uuid PRIMARY KEY,game_id uuid,stage_no integer,session_no integer,title text,scheduled_start timestamptz,scheduled_end timestamptz,status text,agenda_document_id uuid,created_by uuid,opened_at timestamptz,chair_user_id uuid,agenda_notes text NOT NULL DEFAULT '');");
  await db.exec("CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,game_id uuid,title text,registry_no text,body_text text,status_code text,status_label text,current_owner_key text,updated_at timestamptz DEFAULT now());");
  await db.exec("CREATE TABLE public.duma_agenda_items(id uuid PRIMARY KEY,session_id uuid,agenda_no integer,formal_document_id uuid,status text DEFAULT 'pending',UNIQUE(session_id,agenda_no));");
  await db.exec("CREATE TABLE public.institution_meeting_records(game_id uuid,stage_no integer,institution_key text,agenda_document_id uuid,agenda_body text,agenda_prepared_by uuid,agenda_approved_at timestamptz,agenda_approved_by uuid,updated_at timestamptz DEFAULT now(),PRIMARY KEY(game_id,stage_no,institution_key));");
  await db.exec("CREATE TABLE public.formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,to_status text,to_owner text,note text);");
  await db.exec("CREATE TABLE public.game_events(game_id uuid,round_no integer,category text,severity text,title text,body text,created_by uuid);");
  await db.exec(functionSQL);await db.exec(editSQL);
  await db.query("INSERT INTO public.formal_documents(id,game_id,title,registry_no,body_text,status_code,status_label,current_owner_key) VALUES($1,$2,'Повестка № 2','ГОС.ID-ПОВ-ГД-00002','Первоначальная','draft','Проект повестки','gd')",[doc(9),game]);
  for(const n of [1,2])await db.query("INSERT INTO public.formal_documents(id,game_id,title,registry_no,status_code,status_label) VALUES($1,$2,$3,$4,'draft','Черновик')",[doc(n),game,'Законопроект '+n,'ГОС.ID-ЗП-'+n]);
  await db.query("INSERT INTO public.duma_sessions(id,game_id,stage_no,session_no,title,status,agenda_document_id,created_by) VALUES($1,$2,12,2,'Заседание ГД','draft',$3,$4)",[session,game,doc(9),uid]);
  for(const n of [1,2])await db.query("INSERT INTO public.duma_agenda_items(id,session_id,agenda_no,formal_document_id) VALUES($1,$2,$3,$4)",[item(n),session,n,doc(n)]);
  await db.query('SELECT private.sync_duma_session_agenda_document($1)',[session]);
  const read=async()=> (await db.query("SELECT m.agenda_body,m.agenda_approved_at,d.body_text FROM public.institution_meeting_records m JOIN public.formal_documents d ON d.id=m.agenda_document_id WHERE m.game_id=$1",[game])).rows[0];
  await db.query("UPDATE public.institution_meeting_records SET agenda_approved_at=now() WHERE game_id=$1",[game]);
  await db.query('SELECT public.update_stage12_duma_agenda($1,$2,$3,NULL)',[session,'Регламент: выступление по 5 минут',[item(2),item(1)]]);
  let row=await read();
  assert(row.body_text.includes('РЕГЛАМЕНТ И УТОЧНЕНИЯ ПОВЕСТКИ'),'Saved notes included in formal agenda');
  assert(row.agenda_body===row.body_text,'Upper preview synced to lower session NPA');
  assert(row.agenda_approved_at===null,'Draft edits invalidate previous approval');
  assert(row.body_text.indexOf('Законопроект 2')<row.body_text.indexOf('Законопроект 1'),'Reordering is persisted');
  const ordered=(await db.query('SELECT id FROM public.duma_agenda_items WHERE session_id=$1 ORDER BY agenda_no',[session])).rows.map(x=>x.id);
  assert.deepEqual(ordered,[item(2),item(1)]);
  await db.exec('UPDATE private.caller SET permitted=false');
  await assert.rejects(()=>db.query('SELECT public.update_stage12_duma_agenda($1,$2,NULL,NULL)',[session,'Другое уточнение']),/полномочий/i);
  // Before the first approval the chair is not yet registered, but may
  // still prepare the agenda. Registration becomes mandatory once opened.
  await db.exec('UPDATE private.caller SET permitted=true,teacher=false,attended=false');
  await db.query('SELECT public.update_stage12_duma_agenda($1,$2,NULL,NULL)',[session,'Уточнение председателя до регистрации']);
  await db.exec('UPDATE private.caller SET teacher=true,attended=true');
  await assert.rejects(()=>db.query('SELECT public.update_stage12_duma_agenda($1,$2,$3,NULL)',[session,'Другое уточнение',[item(1),item(1)]]),/список вопросов/i,'Reject repeated IDs');
  await db.query("UPDATE public.duma_sessions SET status='open' WHERE id=$1",[session]);
  await db.query("UPDATE public.institution_meeting_records SET agenda_approved_at=now() WHERE game_id=$1",[game]);
  await db.exec('UPDATE private.caller SET teacher=false,attended=false');
  await assert.rejects(()=>db.query('SELECT public.update_stage12_duma_agenda($1,$2,NULL,$3)',[session,'Корректировка без явки','Основание корректировки председателя']),/registration required/);
  await db.exec('UPDATE private.caller SET teacher=true,attended=true');
  await assert.rejects(()=>db.query('SELECT public.update_stage12_duma_agenda($1,$2,$3,$4)',[session,'Изменённый регламент',[item(1),item(2)],'Согласованное изменение порядка']),/порядок вопросов/i);
  await assert.rejects(()=>db.query('SELECT public.update_stage12_duma_agenda($1,$2,NULL,$3)',[session,'Изменённый регламент','']),/основание/i);
  await db.query('SELECT public.update_stage12_duma_agenda($1,$2,NULL,$3)',[session,'Уточнён регламент выступающих','Корректировка по решению председателя']);
  row=await read();
  assert(row.agenda_body.includes('Уточнён регламент выступающих'),'After opening updates visible in upper panel');
  assert(row.agenda_approved_at!==null,'After-opening justified changes preserve approval');
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM public.game_events')).rows[0].n),1,'Manual after-opening corrections audited');
  await db.query("UPDATE public.duma_sessions SET status='closed' WHERE id=$1",[session]);
  await assert.rejects(()=>db.query('SELECT public.update_stage12_duma_agenda($1,$2,NULL,$3)',[session,'Ещё изменение','Решение председателя по вопросу']),/недоступна/i);
  console.log('PASS: canonical agenda edit, item reorder, reapproval, role/attendance, immutable opened order and closed session, audit.');
 } finally{await db.close()}
}
async function layoutCheck(){
 const exec=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
 assert(exec,'Chrome needed');
 const browser=await chromium.launch({headless:true,executablePath:exec,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const html='<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--gs-border:#dde3ef;--gs-radius-sm:12px;--gs-surface-soft:#f6f8fc;--gs-surface:white;--gs-ink:#15294e;--gs-ink-2:#4b5d7b;--gs-muted:#6b7b94;--gs-accent:#2453e6;--gs-accent-soft:#eff3ff;--gs-accent-strong:#1742d2;--gs-border-strong:#cbd9ed}*{box-sizing:border-box}body{margin:0;padding:12px}.civicRegistration{max-width:1140px;margin:auto}.civicMeetingDocuments{display:grid;gap:16px;border:1px solid #dbe4f2;padding:0 0 16px;min-width:0}.civicRegistration .civicMeetingDocuments>button{justify-self:start;width:max-content;margin:0 20px}@media(max-width:600px){.civicRegistration .civicMeetingDocuments>button{margin:0 14px}}'+css+'</style><div class="institutionRegistrationPanel civicRegistration"><div class="civicMeetingDocuments"><button>Открыть повестку в реестре</button><section class="civicAgendaSyncedPreview"><strong>Содержание повестки</strong><pre>Повестка ГД №2 — Очень длинное название законопроекта об устройстве публичной власти и согласовании полномочий</pre></section><section class="civicAgendaEdit"><button>Корректировать повестку</button><div class="civicAgendaEditBody"><div class="civicAgendaOrderItem"><span class="civicAgendaPosition">1</span><span class="civicAgendaOrderTitle">Очень длинное название федерального конституционного законопроекта</span><div class="civicAgendaOrderActions"><button>↑</button><button>↓</button></div></div><label>Регламент<textarea>Пять минут</textarea></label><button>Сохранить</button></div></section></div></div>';
  for(const width of [320,375,430,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:860}});
   await page.setContent(html);
   const data=await page.evaluate(()=>{
    const box=document.querySelector('.civicAgendaSyncedPreview'),editor=document.querySelector('.civicAgendaEdit'),outer=document.querySelector('.civicMeetingDocuments');
    return {scroll:document.documentElement.scrollWidth,container:outer.scrollWidth,client:outer.clientWidth,preview:box.getBoundingClientRect().left,editor:editor.getBoundingClientRect().left,button:document.querySelector('.civicMeetingDocuments>button').getBoundingClientRect().left};
   });
   assert(data.scroll<=width+1&&data.container<=data.client+2,'No overflow at '+width+': '+JSON.stringify(data));
   assert(Math.abs(data.preview-data.editor)<2&&Math.abs(data.button-data.editor)<2,'Aligned preview, edit and NPA button at '+width+': '+JSON.stringify(data));
   await page.close();
  }
  console.log('PASS: agenda form edges aligned and controls fit 320–1440px.');
 }finally{await browser.close();}
}
(async()=>{await dbCheck();await layoutCheck()})().catch(e=>{console.error(e);process.exitCode=1});
