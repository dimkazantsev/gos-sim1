'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261022172500_stage10_programme_rejected_stage11_preserve_preparation.sql','utf8');
const source=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION'));
assert(source.startsWith('CREATE OR REPLACE FUNCTION private.stage_required_final_documents'),'Migration must replace only readiness calculation');
assert(source.includes("p.status='rejected'"),'Stage 11 rejection must keep earlier preparation');
assert(source.includes("v.stage_no=11 AND v.procedure_key='state_program'"),'Only a genuine Stage 11 vote proves readiness');
assert(!/UPDATE\s+public\.(?:game_ballots|game_votes|state_programs|formal_documents|game_stages)/i.test(source),'Migration must never rewrite game history');
const game='10000000-0000-0000-0000-000000000001';
const prog='20000000-0000-0000-0000-000000000002';
const vote='30000000-0000-0000-0000-000000000003';
async function main(){
 const db=new PGlite();
 try{
  await db.exec(`
    CREATE SCHEMA private;
    CREATE TABLE public.formal_documents(id uuid DEFAULT gen_random_uuid(),game_id uuid,stage_no integer,status_code text,doc_type text,subject_key text,title text,metadata jsonb);
    CREATE TABLE public.state_programs(id uuid,game_id uuid,status text);
    CREATE TABLE public.government_program_agenda(id uuid DEFAULT gen_random_uuid(),game_id uuid,program_id uuid,vote_id uuid);
    CREATE TABLE public.game_votes(id uuid,game_id uuid,stage_no integer,procedure_key text);
  `);
  await db.exec(source);
  const missing=async()=>Number((await db.query("SELECT (d->>'fulfilled')::boolean AS ok FROM jsonb_array_elements(private.stage_required_final_documents($1,10)) d WHERE d->>'template_key'='state_program'",[game])).rows[0].ok);
  await db.query("INSERT INTO state_programs(id,game_id,status) VALUES($1,$2,'ready')",[prog,game]);
  await db.query("INSERT INTO formal_documents(game_id,stage_no,status_code,doc_type,subject_key,title,metadata) VALUES($1,10,'draft','state_program','ministry','Госпрограмма',jsonb_build_object('auto_synced','true','state_program_id',$2::text))",[game,prog]);
  assert.equal(await missing(),1,'Prepared programme from Stage 10 counts');
  await db.query("UPDATE state_programs SET status='rejected' WHERE id=$1",[prog]);
  assert.equal(await missing(),0,'Rejected programme without Stage 11 vote does not qualify');
  await db.query("INSERT INTO government_program_agenda(game_id,program_id) VALUES($1,$2)",[game,prog]);
  assert.equal(await missing(),0,'Agenda alone cannot prove Government vote');
  await db.query("INSERT INTO game_votes(id,game_id,stage_no,procedure_key) VALUES($1,$2,11,'state_program')",[vote,game]);
  await db.query("UPDATE government_program_agenda SET vote_id=$1 WHERE game_id=$2 AND program_id=$3",[vote,game,prog]);
  assert.equal(await missing(),1,'Valid linked Stage 11 vote retains completed Stage 10 preparation');
  await db.query("UPDATE game_votes SET procedure_key='unrelated' WHERE id=$1",[vote]);
  assert.equal(await missing(),0,'Unrelated vote does not prove programme readiness');
  await db.query("UPDATE game_votes SET procedure_key='state_program' WHERE id=$1",[vote]);
  await db.query("UPDATE formal_documents SET status_code='unverified' WHERE game_id=$1",[game]);
  assert.equal(await missing(),0,'Unverified document cannot erase minimum documentary checks');
  await db.query("UPDATE formal_documents SET status_code='draft' WHERE game_id=$1",[game]);
  assert.equal(await missing(),1,'Linked draft is valid original prepared programme');
  console.log('PASS: rejected Stage 11 vote preserves Stage 10 work; drafts, false links and unrelated votes stay blocked.');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
