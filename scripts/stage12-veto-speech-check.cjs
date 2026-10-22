'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261023041500_stage12_veto_sf_confirmation_and_speech_control.sql','utf8');
const documentView=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
const discussion=fs.readFileSync('components/game/DumaReadingDiscussion.tsx','utf8');
const preset=fs.readFileSync('components/game/proceduralVoting.ts','utf8');
assert(documentView.includes("confirm_fz_veto_sf_review")&&documentView.includes("veto_overridden"));
assert(documentView.includes("selected.doc_type!=='fkz_bill'"),'No FKZ veto button');
assert(discussion.includes("adjust_duma_speech_time")&&discussion.includes("p_expected_end:item.speech_ends_at"),'Optimistic update uses last visible timer version');
assert(preset.includes("решение Совета Федерации отдельно подтверждает преподаватель"),'No false automatic Senate approval');
const id=n=>'30000000-0000-0000-0000-'+String(n).padStart(12,'0');
const game=id(1),bill=id(2),teacher=id(3),chair=id(4),vote=id(5),session=id(6),item=id(7);
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE ROLE anon;CREATE ROLE authenticated;
   CREATE SCHEMA auth; CREATE SCHEMA private;
   CREATE TABLE private.actor(uid uuid,teacher boolean,manage boolean,registered boolean,president boolean);
   INSERT INTO private.actor VALUES('${teacher}',true,true,true,false);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT uid FROM private.actor$$;
   CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT teacher FROM private.actor$$;
   CREATE FUNCTION private.can_manage_duma_session(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT manage FROM private.actor$$;
   CREATE FUNCTION private.matches_formal_owner(uuid,uuid,text,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT president FROM private.actor$$;
   CREATE FUNCTION private.require_duma_stage_open(uuid,integer) RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
   CREATE FUNCTION private.require_game_meeting_registration(uuid,uuid,integer,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT (SELECT registered FROM private.actor) THEN RAISE EXCEPTION 'Registration required';END IF;END;$$;
   CREATE TABLE public.formal_documents(
    id uuid PRIMARY KEY,game_id uuid,author_id uuid,doc_type text,workflow_key text,
    status_code text,status_label text,current_owner_key text,current_step integer,updated_at timestamptz
   );
   CREATE TABLE public.game_votes(
    id uuid PRIMARY KEY,game_id uuid,formal_document_id uuid,formal_step_code text,
    procedure_key text,institution_key text,voting_mode text,majority_kind text,majority_value numeric,
    quorum_kind text,quorum_value numeric,pass_transition text,fail_transition text,
    status text,result_code text,result_quorum_met boolean,result_yes numeric
   );
   CREATE TABLE public.game_profiles(game_id uuid,user_id uuid,signature_path text);
   CREATE TABLE public.duma_sessions(id uuid PRIMARY KEY,game_id uuid,stage_no integer,reading_protocol boolean,status text);
   CREATE TABLE public.duma_agenda_items(id uuid PRIMARY KEY,game_id uuid,session_id uuid,formal_document_id uuid,
    status text,discussion_phase text,speaker_user_id uuid,speech_ends_at timestamptz,opened_document_step text);
   CREATE TABLE public.formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,
    from_status text,to_status text,from_owner text,to_owner text,note text);
  `);
  await db.exec(migration);
  await db.query("INSERT INTO public.formal_documents VALUES($1,$2,$3,'fz_bill','bill','president_veto','Вето','gd_council',9,now())",[bill,game,chair]);
  const ballot=[vote,game,bill,'president_veto','presidential_veto_override','gd','mandate','eligible_fraction',2/3,'fraction',0.5,'advance','reject','closed','passed',true,300];
  await db.query("INSERT INTO public.game_votes VALUES("+Array.from({length:17},(_,i)=>'$'+(i+1)).join(',')+")",ballot);
  await db.query("UPDATE public.formal_documents SET status_code='published',current_step=10 WHERE id=$1",[bill]);
  assert.equal((await db.query("SELECT status_code,current_owner_key,current_step FROM public.formal_documents WHERE id=$1",[bill])).rows[0].status_code,'veto_sf_pending','Vote cannot publish without Senate');
  await assert.rejects(db.query("SELECT public.confirm_fz_veto_sf_review($1,true,NULL)",[bill]),/Укажите подтверждение/);
  await db.query("UPDATE private.actor SET teacher=false");
  await assert.rejects(db.query("SELECT public.confirm_fz_veto_sf_review($1,true,'За: не менее 2/3')",[bill]),/Только преподаватель/);
  await db.query("UPDATE private.actor SET teacher=true");
  await db.query("SELECT public.confirm_fz_veto_sf_review($1,true,'Учебное подтверждение СФ: за не менее 2/3 от общего числа сенаторов')",[bill]);
  assert.equal((await db.query("SELECT status_code,current_owner_key FROM public.formal_documents WHERE id=$1",[bill])).rows[0].status_code,'veto_overridden');
  await assert.rejects(db.query("UPDATE public.formal_documents SET status_code='rejected' WHERE id=$1",[bill]),/подписывает действующий Президент/);
  await assert.rejects(db.query("UPDATE public.formal_documents SET status_code='published',current_step=10,current_owner_key='system' WHERE id=$1",[bill]),/подписывает действующий Президент/);
  await db.query("UPDATE private.actor SET uid=$1,president=true,teacher=false",[chair]);
  await db.query("INSERT INTO public.game_profiles VALUES($1,$2,'signed/test.png')",[game,chair]);
  await db.query("UPDATE public.formal_documents SET status_code='published',current_step=10,current_owner_key='system' WHERE id=$1",[bill]);
  assert.equal((await db.query("SELECT status_code FROM public.formal_documents WHERE id=$1",[bill])).rows[0].status_code,'published');
  await db.query("INSERT INTO public.duma_sessions VALUES($1,$2,12,true,'open')",[session,game]);
  await db.query("INSERT INTO public.duma_agenda_items VALUES($1,$2,$3,$4,'in_progress','report',$5,now()+interval '90 seconds','reading1')",[item,game,session,bill,chair]);
  const initial=(await db.query("SELECT speech_ends_at FROM public.duma_agenda_items WHERE id=$1",[item])).rows[0].speech_ends_at;
  const updated=(await db.query("SELECT public.adjust_duma_speech_time($1,$2::timestamptz,30) AS t",[item,initial])).rows[0].t;
  const delta=(new Date(updated).getTime()-new Date(initial).getTime())/1000;
  assert(Math.abs(delta-30)<1,'Server adds exactly 30 seconds without polling');
  await assert.rejects(db.query("SELECT public.adjust_duma_speech_time($1,$2::timestamptz,30)",[item,initial]),/уже изменено/,'Stale retry cannot double-charge time');
  await db.query("UPDATE private.actor SET manage=false");
  await assert.rejects(db.query("SELECT public.adjust_duma_speech_time($1,$2::timestamptz,30)",[item,updated]),/председатель/,'Unauthorized user cannot change timer');
  console.log('PASS: veto cannot publish prematurely; Senate teacher confirmation; President signature; FKZ button absent; live timer +30 and stale/unauthorized protection.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
