'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261022132438_stage12_auto_duma_draft_agenda.sql','utf8');
const component=fs.readFileSync('components/game/LegislativeSessionLab.tsx','utf8');
for(const name of ['private.sync_stage12_draft_bill_agenda','private.stage12_new_bill_to_duma_agenda','private.stage12_new_duma_session_autofill','public.correct_duma_agenda_after_open'])assert(migration.includes(name),'Required function '+name);
for(const name of ['zzz_stage12_bill_autofill_duma_agenda','zzz_stage12_new_session_autofill','FOR UPDATE','ON CONFLICT (session_id,formal_document_id) DO NOTHING'])assert(migration.includes(name),'Required guard '+name);
assert(migration.includes('private.can_manage_duma_session')&&migration.includes('private.require_game_meeting_registration'),'Correction has server role and attendance checks');
assert(component.includes("supabase.rpc('correct_duma_agenda_after_open'")&&component.includes('correctionReason.trim().length<10'),'UI enforces justified corrections');
const extract=(name,tag)=>{
 const start=migration.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');
 const end=migration.indexOf('$'+tag+'$;',start);
 assert(start>=0&&end>start,'Missing SQL function '+name);
 return migration.slice(start,end+tag.length+3);
};
const definitions=[
 extract('private.sync_stage12_draft_bill_agenda','sync12'),
 extract('private.stage12_new_bill_to_duma_agenda','new12'),
 extract('private.stage12_new_duma_session_autofill','session12'),
 extract('public.correct_duma_agenda_after_open','correct12')
].join('\n');
const triggerSQL=migration.slice(migration.indexOf('DROP TRIGGER IF EXISTS zzz_stage12_bill_autofill_duma_agenda'),migration.indexOf('-- Controlled post-opening correction'));
const game='10000000-0000-0000-0000-000000000001';
const chair='30000000-0000-0000-0000-000000000001';
const doc=(i)=>'20000000-0000-0000-0000-'+String(i).padStart(12,'0');
async function run(){
 const db=new PGlite();
 try{
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA private;CREATE SCHEMA auth;");
  await db.exec("CREATE TABLE public.duma_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,stage_no integer,session_no integer,status text);");
  await db.exec("CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,game_id uuid,stage_no integer,workflow_key text,status_code text,current_owner_key text,created_at timestamptz DEFAULT clock_timestamp(),registry_no text);");
  await db.exec("CREATE TABLE public.duma_agenda_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,game_id uuid,formal_document_id uuid,agenda_no integer,status text DEFAULT 'pending',result_note text,UNIQUE(session_id,formal_document_id),UNIQUE(session_id,agenda_no));");
  await db.exec("CREATE TABLE public.game_events(game_id uuid,round_no integer,category text,severity text,title text,body text,created_by uuid);");
  await db.exec("CREATE TABLE private.test_actor(uid uuid,permit boolean,registered boolean,stage_open boolean,teacher boolean);");
  await db.query("INSERT INTO private.test_actor VALUES($1,true,true,true,false)",[chair]);
  await db.exec("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT uid FROM private.test_actor LIMIT 1$$;");
  await db.exec("CREATE FUNCTION private.can_manage_duma_session(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT permit FROM private.test_actor LIMIT 1$$;");
  await db.exec("CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT teacher FROM private.test_actor LIMIT 1$$;");
  await db.exec("CREATE FUNCTION private.require_duma_stage_open(uuid,integer) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT (SELECT stage_open FROM private.test_actor LIMIT 1) THEN RAISE EXCEPTION 'stage closed'; END IF; END;$$;");
  await db.exec("CREATE FUNCTION private.require_game_meeting_registration(uuid,uuid,integer,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT (SELECT registered FROM private.test_actor LIMIT 1) THEN RAISE EXCEPTION 'registration required'; END IF; END;$$;");
  await db.exec(definitions);
  await db.exec(triggerSQL);
  const insert=async(i,stage=12)=>db.query("INSERT INTO public.formal_documents(id,game_id,stage_no,workflow_key,status_code,current_owner_key,registry_no) VALUES($1,$2,$3,'bill','draft','author',$4)",[doc(i),game,stage,'ГОС.ID-ЗП-'+i]);
  const agenda=async()=> (await db.query("SELECT agenda_no,formal_document_id FROM public.duma_agenda_items WHERE game_id=$1 ORDER BY agenda_no",[game])).rows;
  await insert(1);await insert(2);await insert(30,6);
  assert.equal((await agenda()).length,0,'Packages exist before session');
  const session='40000000-0000-0000-0000-000000000001';
  await db.query("INSERT INTO public.duma_sessions VALUES($1,$2,12,2,'draft')",[session,game]);
  assert.deepEqual((await agenda()).map(x=>x.agenda_no),[1,2],'Draft session backfills existing bills');
  const synced=await db.query('SELECT private.sync_stage12_draft_bill_agenda($1,NULL) AS count',[session]);
  assert.equal(Number(synced.rows[0].count),0,'Idempotent backfill');
  await insert(3);
  assert.equal((await agenda()).length,3,'New package auto-appears in draft agenda');
  await Promise.all(Array.from({length:40},(_,i)=>insert(i+100)));
  const present=await agenda();
  assert.equal(present.length,43,'40 simulated package submissions are not lost or duplicated');
  assert.equal(new Set(present.map(x=>x.agenda_no)).size,43,'Serial agenda numbering stays unique');
  await db.query("UPDATE public.duma_sessions SET status='open' WHERE id=$1",[session]);
  await insert(4);
  assert.equal((await agenda()).length,43,'After opening no automatic additions');
  await assert.rejects(()=>db.query('SELECT public.correct_duma_agenda_after_open($1,$2,$3)',[session,doc(4),'a']),/основание/i,'Reason required');
  await db.exec('UPDATE private.test_actor SET permit=false');
  await assert.rejects(()=>db.query('SELECT public.correct_duma_agenda_after_open($1,$2,$3)',[session,doc(4),'Основание ручной корректировки']),/полномочий/i,'No rights');
  await db.exec('UPDATE private.test_actor SET permit=true,registered=false');
  await assert.rejects(()=>db.query('SELECT public.correct_duma_agenda_after_open($1,$2,$3)',[session,doc(4),'Основание ручной корректировки']),/registration required/i,'No registration');
  await db.exec('UPDATE private.test_actor SET registered=true');
  await db.query('SELECT public.correct_duma_agenda_after_open($1,$2,$3)',[session,doc(4),'Внесено по решению председателя']);
  assert.equal((await agenda()).length,44,'Justified authorised correction succeeds');
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM public.game_events')).rows[0].n),1,'Correction is recorded in history');
  await assert.rejects(()=>db.query('SELECT public.correct_duma_agenda_after_open($1,$2,$3)',[session,doc(4),'Повторное решение председателя']),/присутствует/i,'No duplicate corrections');
  await db.query("UPDATE public.duma_sessions SET status='closed' WHERE id=$1",[session]);
  await assert.rejects(()=>db.query('SELECT public.correct_duma_agenda_after_open($1,$2,$3)',[session,doc(3),'Повторное исправление повестки']),/открытого/i,'Closed session immutable');
  console.log('PASS: preexisting bills and 40 simulated inserts, sequential numbering, open-session freeze, role and registration checks, audited manual correction.');
 }finally{await db.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
