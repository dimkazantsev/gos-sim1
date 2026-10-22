'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261023050000_stage12_first_reading_full_adoption.sql','utf8');
const ui=fs.readFileSync('components/game/DumaReadingDiscussion.tsx','utf8');
assert(ui.includes("set_duma_first_reading_route")&&ui.includes("Подтверждаю, что проект не регулирует предметы совместного ведения"));
const id=n=>'40000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
const db=new PGlite();try{
await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;
 CREATE SCHEMA auth;CREATE SCHEMA private;
 CREATE TABLE private.actor(uid uuid,manager boolean);
 INSERT INTO private.actor VALUES('${id(4)}',true);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT uid FROM private.actor$$;
 CREATE FUNCTION private.can_manage_duma_session(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT manager FROM private.actor$$;
 CREATE FUNCTION private.require_duma_stage_open(uuid,integer) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END;$$;
 CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE TABLE public.duma_sessions(id uuid PRIMARY KEY,game_id uuid,stage_no integer,reading_no integer,reading_protocol boolean,status text);
 CREATE TABLE public.duma_agenda_items(id uuid PRIMARY KEY,game_id uuid,session_id uuid,formal_document_id uuid,
  status text,discussion_phase text,opened_document_step text,started_at timestamptz);
 CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,game_id uuid,stage_no integer,workflow_key text,
  doc_type text,status_code text,current_step integer,status_label text,current_owner_key text,title text,metadata jsonb);
 CREATE TABLE public.game_votes(id uuid PRIMARY KEY,game_id uuid,formal_document_id uuid,formal_step_code text,status text,
  procedure_key text,institution_key text,voting_mode text,quorum_kind text,quorum_value numeric,majority_kind text,
  majority_value numeric,pass_transition text,fail_transition text,title text,body text,result_code text,
  result_quorum_met boolean,result_yes numeric);
 CREATE TABLE public.formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,from_status text,to_status text,note text);
`);
await db.exec(sql);
await db.query("INSERT INTO public.duma_sessions VALUES($1,$2,12,1,true,'open')",[id(3),id(1)]);
await db.query("INSERT INTO public.formal_documents VALUES($1,$2,12,'bill','fz_bill','reading1',4,'I чтение','gd','Законопроект','{}')",[id(2),id(1)]);
await db.query("INSERT INTO public.duma_agenda_items(id,game_id,session_id,formal_document_id,status,discussion_phase,opened_document_step,started_at) VALUES($1,$2,$3,$4,'in_progress','committee','reading1',now())",[id(5),id(1),id(3),id(2)]);
await assert.rejects(db.query("SELECT public.set_duma_first_reading_route($1,'adopt_in_full','Проект не является предметом совместного ведения и подготовлен комитетом',false)",[id(5)]),/совместного ведения/);
await db.query("SELECT public.set_duma_first_reading_route($1,'adopt_in_full','Проект не относится к предметам совместного ведения, заключение профильного комитета положительное',true)",[id(5)]);
assert.equal((await db.query("SELECT first_reading_route FROM public.duma_agenda_items WHERE id=$1",[id(5)])).rows[0].first_reading_route,'adopt_in_full');
await db.query("UPDATE public.duma_agenda_items SET discussion_phase='vote' WHERE id=$1",[id(5)]);
await db.query("INSERT INTO public.game_votes(id,game_id,formal_document_id,formal_step_code,status,procedure_key,institution_key,voting_mode,quorum_kind,quorum_value,majority_kind,majority_value,pass_transition,fail_transition,title,body,result_code,result_quorum_met,result_yes) VALUES($1,$2,$3,'reading1','open','bill_reading1','gd','mandate','fraction',0.5,'eligible_majority',0.5,'advance','reject','Первое чтение','Проверка',null,null,0)",[id(6),id(1),id(2)]);
assert.equal((await db.query("SELECT procedure_key FROM public.game_votes WHERE id=$1",[id(6)])).rows[0].procedure_key,'bill_reading1_full');
await db.query("UPDATE public.game_votes SET status='closed',result_code='passed',result_quorum_met=true,result_yes=226 WHERE id=$1",[id(6)]);
await db.query("UPDATE public.formal_documents SET status_code='amendments',current_step=5 WHERE id=$1",[id(2)]);
const row=(await db.query("SELECT status_code,current_step,current_owner_key FROM public.formal_documents WHERE id=$1",[id(2)])).rows[0];
assert.equal(row.status_code,'president','First-reading acceptance skips second and third readings in game route');
assert.equal(row.current_step,9);
assert.equal(row.current_owner_key,'president');
await db.query("UPDATE private.actor SET manager=false");
await assert.rejects(db.query("SELECT public.set_duma_first_reading_route($1,'continue',null,false)",[id(5)]),/председательствующий/);
console.log('PASS: chairman confirmation, joint-jurisdiction guard, approved 226-vote whole-law route, direct presidential signature stage and unauthorized denial.');
}finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
