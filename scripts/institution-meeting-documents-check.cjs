/* PGlite-only meeting agenda / minutes check: no production data writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const teacher='00000000-0000-0000-0000-000000000001',student='00000000-0000-0000-0000-000000000002',game='00000000-0000-0000-0000-000000000050';
(async()=>{
 const db=new PGlite();
 try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema private;create schema auth;"+
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
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261017143200_institution_meeting_permissions_read.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261017155200_allow_initial_agenda_after_legacy_registration.sql'),'utf8'));
 const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const register=()=>q("select public.register_institution_session_at_stage($1,'ksrf',2)",[game]);
 const permissions=async target=>(await q("select public.get_my_institution_meeting_permissions($1,2,'ksrf') as role",[target]))[0].role;
 const managerRights=await permissions(game);
 assert.deepEqual(managerRights,{can_coordinate:true,can_prepare:true,can_attend:true},'Teacher is coordinator, preparer and may attend in this SQL fixture');
 await db.exec("set request.jwt.claim.sub='"+student+"';");
 assert.deepEqual(await permissions(game),{can_coordinate:false,can_prepare:false,can_attend:true},'Student without a mandate cannot approve or edit an agenda');
 await assert.rejects(register(),/повестки/);
 await db.exec("set request.jwt.claim.sub='"+teacher+"';");
 const agenda=(await q("select public.save_institution_meeting_document($1,2,'ksrf','agenda',$2,$3) as id",[game,'1. Рассмотрение избирательной системы и выбор правила распределения мандатов',student]))[0].id;
 assert(agenda,'Real formal document ID is returned');
 const ui=fs.readFileSync(path.join(root,'components/game/InstitutionRegistrationPanel.tsx'),'utf8');
 assert(ui.includes("get_my_institution_meeting_permissions"),'UI gets authoritative role from the new read-only RPC');
 assert(ui.includes("const meetingCoordinator=!!verifiedRights?.can_coordinate"),'No permission inference from role labels');
 assert(ui.includes('Проверяем ваши полномочия'),'Controls wait until roles are confirmed');
 assert(ui.includes('civicMeetingSteps')&&ui.includes('civicMeetingError'),'Meeting steps and action-local errors must be visible');
 assert(ui.includes('Открыть повестку в реестре НПА'),'Agenda link must be available after saving');
 assert(!ui.includes("const meetingCoordinator=!!g.teacher||"),'Do not reintroduce client-only privilege checks');
 assert(ui.includes('const canApproveAgenda=meetingCoordinator&&agendaDraft'), 'Approval unavailable without a prepared document');
 assert(ui.includes('agendaTextLength<30'), 'Explain the minimum 30-character rule before saving');
 assert(ui.includes('Сохранить и утвердить повестку'), 'Coordinator save action matches server auto-approval');
 assert(ui.includes('Сохранить проект повестки в реестре НПА'), 'Delegate cannot publish the draft');
 assert(ui.includes('Вы можете зарегистрироваться после утверждения повестки'), 'Ordinary participants can see the next step');
 assert(ui.includes('canPrepare&&!readOnly&&!agendaReady'), 'Do not expose editable fields in completed/locked stage views');
 assert(!ui.includes("'Сначала подготовьте документ в реестре НПА'"), 'The form itself creates the agenda document');
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
 // Independent draft from a delegated student: only a coordinator may approve it.
 const secondGame='00000000-0000-0000-0000-000000000051';
 await db.exec("insert into games values('"+secondGame+"',2);insert into game_stages values('"+secondGame+"',2);");
 await q("select public.assign_institution_meeting_secretary($1,2,'ksrf',$2)",[secondGame,student]);
 await db.exec("set request.jwt.claim.sub='"+student+"';");
 assert.deepEqual(await permissions(secondGame),{can_coordinate:false,can_prepare:true,can_attend:true},'Delegated student may prepare a draft but cannot approve it');
 const delegatedAgenda=(await q("select public.save_institution_meeting_document($1,2,'ksrf','agenda',$2) as id",[secondGame,'1. Доклады о составе органа. 2. Рассмотрение подготовленного документа и голосование.']))[0].id;
 assert.equal((await q('select status_code from formal_documents where id=$1',[delegatedAgenda]))[0].status_code,'draft');
 await assert.rejects(()=>q("select public.approve_institution_meeting_agenda($1,2,'ksrf')",[secondGame]),/председател/);
 await db.exec("set request.jwt.claim.sub='"+teacher+"';");
 await q("select public.approve_institution_meeting_agenda($1,2,'ksrf')",[secondGame]);
 assert.equal((await q('select status_code from formal_documents where id=$1',[delegatedAgenda]))[0].status_code,'published');
 // Historical bug: registered attendees existed before any agenda was prepared.
 // Preserve those rows and allow only the FIRST agenda; later edits are frozen.
 const legacyGame='00000000-0000-0000-0000-000000000052';
 await db.exec("insert into games values('"+legacyGame+"',2);insert into game_stages values('"+legacyGame+"',2);");
 await q("insert into institution_meeting_records(game_id,stage_no,institution_key) values($1,2,'ksrf')",[legacyGame]);
 await q("insert into institution_session_registrations(game_id,stage_no,institution_key,user_id) values($1,2,'ksrf',$2)",[legacyGame,student]);
 assert.equal((await q("select count(*)::int as n from institution_session_registrations where game_id=$1",[legacyGame]))[0].n,1);
 await db.exec("set request.jwt.claim.sub='"+student+"';");
 await assert.rejects(()=>q("select public.save_institution_meeting_document($1,2,'ksrf','agenda',$2)",[legacyGame,'Попытка обычного студента создать повестку без поручения']),/председател/);
 await db.exec("set request.jwt.claim.sub='"+teacher+"';");
 const firstAgenda=(await q("select public.save_institution_meeting_document($1,2,'ksrf','agenda',$2) as id",[legacyGame,'1. Проверка полномочий участников заседания. 2. Рассмотрение проекта решения и обсуждение.']))[0].id;
 assert(firstAgenda);
 assert.equal((await q("select count(*)::int as n from institution_session_registrations where game_id=$1",[legacyGame]))[0].n,1,'Historical registration remains intact');
 assert.equal((await q("select status_code from formal_documents where id=$1",[firstAgenda]))[0].status_code,'published','Initial agenda is approved');
 await assert.rejects(()=>q("select public.save_institution_meeting_document($1,2,'ksrf','agenda',$2)",[legacyGame,'Поменять повестку после регистрации должно быть невозможно']),/После начала регистрации повестку менять нельзя/);
 assert.equal((await q("select agenda_document_id from institution_meeting_records where game_id=$1",[legacyGame]))[0].agenda_document_id,firstAgenda);
 assert(ui.includes('const canWriteAgenda=!agendaHasDocument||!hasSessionRegistrations'),'Client prevents subsequent editing');
 assert(ui.includes("const preStageKsrf=body==='ksrf'&&(stage===2||stage===3)"),'KSRF leaders can prepare and register before work starts');
 assert(ui.includes('meetingActionsLocked'),'Meeting controls preserve closed-stage rules outside KSRF 2/3');
 assert(ui.includes("meetingActionsLocked?'Этап закрыт'"),'Other closed-stage attendance remains unavailable');
 assert(ui.includes('Участники были зарегистрированы до оформления повестки'),'Explain why legacy agenda creation is allowed');
 assert(ui.includes('onMeetingReadyChange?.(ready)'),'Session gate updates after approved agenda and personal registration');
 console.log('PASS meeting agenda: normal permissions, legacy attendance preserved, initial approval succeeds, later edits locked');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
