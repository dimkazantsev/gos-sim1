/* PGlite-only meeting agenda / minutes check: no production data writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const teacher='00000000-0000-0000-0000-000000000001',student='00000000-0000-0000-0000-000000000002',game='00000000-0000-0000-0000-000000000050';
(async()=>{
 const db=new PGlite();
 try{
 await db.exec("create role anon;create role authenticated;create schema private;create schema auth;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "create table games(id uuid primary key,current_round integer not null default 2);"+
 "create table game_stages(game_id uuid,stage_no integer,primary key(game_id,stage_no));"+
 "create table institution_units(id uuid,game_id uuid,head_user_id uuid);"+
 "create table game_office_assignments(game_id uuid,user_id uuid,status text,role_title text);"+
 "create table institution_session_registrations(game_id uuid,stage_no integer,institution_key text,user_id uuid,primary key(game_id,stage_no,institution_key,user_id));"+
 "create table game_votes(id uuid default gen_random_uuid(),game_id uuid,stage_no integer,institution_key text,status text);"+
 "create sequence public.formal_registry_seq;"+
 "create table formal_documents(id uuid primary key,game_id uuid,stage_no integer,registry_no text,title text,doc_type text,subject_key text,subject_label text,author_id uuid,body_text text,workflow_key text,workflow_steps jsonb,current_step integer,status_code text,status_label text,current_owner_key text,metadata jsonb,updated_at timestamptz default now());"+
 "create table formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,to_status text,to_owner text,note text);"+
 "create function private.is_game_teacher(p_game uuid) returns boolean language sql stable as $$select auth.uid()='"+teacher+"'::uuid$$;"+
 "create function private.is_game_member(p_game uuid) returns boolean language sql stable as $$select auth.uid() in ('"+teacher+"'::uuid,'"+student+"'::uuid)$$;"+
 "create function private.can_manage_duma_session(p_game uuid,p_uid uuid) returns boolean language sql stable as $$select p_uid='"+teacher+"'::uuid$$;"+
 "create function private.party_led_by(p_game uuid,p_uid uuid) returns uuid language sql stable as $$select case when p_uid='"+teacher+"'::uuid then p_uid else null::uuid end$$;"+
 "create function private.vote_member_has_office(p_game uuid,p_uid uuid,p_body text) returns boolean language sql stable as $$select p_uid in ('"+teacher+"'::uuid,'"+student+"'::uuid) and p_body='ksrf'$$;"+
 "create function private.role_matches_voting_body(p_role text,p_body text) returns boolean language sql stable as $$select false$$;"+
 "create function private.formal_workflow(p_key text) returns jsonb language sql stable as $$select '[]'::jsonb$$;"+
 "insert into games values('"+game+"',2);"+
 "insert into game_stages values('"+game+"',2);"+
 "set request.jwt.claim.sub='"+teacher+"';");
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261016160500_institution_meeting_agenda_minutes.sql'),'utf8'));
 const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const register=()=>q("select public.register_institution_session_at_stage($1,'ksrf',2)",[game]);
 await db.exec("set request.jwt.claim.sub='"+student+"';");
 await assert.rejects(register(),/повестки/);
 await db.exec("set request.jwt.claim.sub='"+teacher+"';");
 const agenda=(await q("select public.save_institution_meeting_document($1,2,'ksrf','agenda',$2,$3) as id",[game,'1. Рассмотрение избирательной системы и выбор правила распределения мандатов',student]))[0].id;
 assert(agenda,'Real formal document ID is returned');
 const docs=await q('select doc_type,registry_no,status_code from formal_documents where id=$1',[agenda]);
 assert.equal(docs[0].doc_type,'meeting_agenda');assert(docs[0].registry_no);assert.equal(docs[0].status_code,'published');
 await db.exec("set request.jwt.claim.sub='"+student+"';");
 await register();
 await assert.rejects(()=>q("select public.save_institution_meeting_document($1,2,'ksrf','agenda',$2)",[game,'Изменение после регистрации всех депутатов']),/регистрации/);
 const session=await q("select count(*)::integer n from institution_session_registrations where game_id=$1",[game]);
 assert.equal(session[0].n,1);
 await q("insert into game_votes(game_id,stage_no,institution_key,status) values($1,2,'ksrf','open')",[game]);
 await assert.rejects(()=>q("select public.save_institution_meeting_document($1,2,'ksrf','minutes',$2)",[game,'Итоги заседания: кворум, обсуждение, голосование, принятое решение']),/голосования/);
 await q("update game_votes set status='closed' where game_id=$1",[game]);
 const minutes=(await q("select public.save_institution_meeting_document($1,2,'ksrf','minutes',$2) as id",[game,'Присутствовали участники КСРФ. Кворум установлен. Решение отклонено большинством голосов.']))[0].id;
 assert(minutes);const draft=await q('select status_code from formal_documents where id=$1',[minutes]);
 assert.equal(draft[0].status_code,'draft','Delegate must not approve the protocol');
 await assert.rejects(()=>q("select public.approve_institution_meeting_minutes($1,2,'ksrf')",[game]),/председатель/);
 await db.exec("set request.jwt.claim.sub='"+teacher+"';");
 await q("select public.approve_institution_meeting_minutes($1,2,'ksrf')",[game]);
 const approved=await q('select minutes_approved_at is not null as ok from institution_meeting_records where game_id=$1',[game]);
 assert(approved[0].ok);
 assert.equal((await q('select status_code from formal_documents where id=$1',[minutes]))[0].status_code,'published');
 console.log('PASS meeting agenda gate, numbered documents, delegate draft, teacher approval, minutes-after-votes and preserved registration');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
