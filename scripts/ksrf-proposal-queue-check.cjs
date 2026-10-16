/* Isolated PostgreSQL fixture: no production data or credentials. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const teacher='00000000-0000-0000-0000-000000000001',student='00000000-0000-0000-0000-000000000002',game='00000000-0000-0000-0000-000000000050';
(async()=>{
 const db=new PGlite();
 try{
 await db.exec("create role anon;create role authenticated;create schema private;create schema auth;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "create table games(id uuid primary key);"+
 "create table game_activity(game_id uuid,actor_id uuid,event_type text,label text,view_key text,payload jsonb);"+
 "create table institution_session_registrations(game_id uuid,stage_no integer,institution_key text,user_id uuid);"+
 "create table game_votes(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer,title text,body text,voting_mode text,status text default 'open',created_by uuid,institution_key text,procedure_key text,quorum_kind text,quorum_value numeric,majority_kind text,majority_value numeric,allow_abstain boolean,tie_breaker_chair boolean,pass_transition text,fail_transition text,result_code text,opened_at timestamptz default now());"+
 "create table parliamentary_election_rules(id uuid primary key default gen_random_uuid(),game_id uuid,system_type text,allocation_method text,majoritarian_method text,proportional_share integer,rationale text,status text default 'draft',vote_id uuid,proposed_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());"+
 "create table regional_election_rules(id uuid primary key default gen_random_uuid(),game_id uuid,method text,rationale text,status text default 'draft',vote_id uuid,proposed_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());"+
 "create function private.is_game_teacher(p_game uuid) returns boolean language sql stable as $$select auth.uid()='"+teacher+"'::uuid$$;"+
 "create function private.can_propose_ksrf(p_game uuid,p_uid uuid) returns boolean language sql stable as $$select p_uid in ('"+teacher+"'::uuid,'"+student+"'::uuid)$$;"+
 "insert into games(id) values('"+game+"');");
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261016154000_ksrf_serial_proposal_queue.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261017195600_ksrf_vote_description_russian.sql'),'utf8'));
 await db.exec("create trigger trg_electoral_rule_vote after update of status on game_votes for each row execute function private.electoral_rule_vote_trigger();"+
 "set request.jwt.claim.sub='"+teacher+"';");
 const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const insert=async(method)=>(await q('insert into parliamentary_election_rules(game_id,system_type,allocation_method,proposed_by) values($1,$2,$3,$4) returning id',[game,'proportional',method,teacher]))[0].id;
 const a=await insert('dhondt'),b=await insert('sainte_lague'),c=await insert('hare');
 const open=async id=>(await q('select public.open_parliamentary_rule_vote($1) as id',[id]))[0].id;
 const first=await open(a);
 assert(first);
 assert.match((await q('select body from game_votes where id=$1',[first]))[0].body,/Система: Пропорциональная\\. Метод распределения мандатов: Метод Д’Ондта\\./);assert.equal(await open(b),null);assert.equal(await open(c),null);
 await q("update game_votes set status='closed',result_code='rejected' where id=$1",[first]);
 let rows=await q('select id,status,vote_id from parliamentary_election_rules where game_id=$1',[game]);
 assert.equal(rows.find(r=>r.id===a).status,'rejected');
 assert.equal(rows.find(r=>r.id===b).status,'vote_open');
 assert.match((await q('select body from game_votes where id=$1',[rows.find(r=>r.id===b).vote_id]))[0].body,/Метод Сент-Лагю\\./);
 assert.equal(rows.find(r=>r.id===c).status,'draft');
 await q("update game_votes set status='closed',result_code='passed' where id=$1",[rows.find(r=>r.id===b).vote_id]);
 rows=await q('select id,status from parliamentary_election_rules where game_id=$1',[game]);
 assert.equal(rows.find(r=>r.id===b).status,'adopted');
 assert.equal(rows.find(r=>r.id===c).status,'rejected');
 await assert.rejects(()=>open(c),/уже рассмотрен|Решение уже принято/);
 await q("select public.reopen_ksrf_question($1,'electoral_system',$2)",[game,'Ошибка итогового голосования, необходимо исправить']);
 rows=await q('select id,status from parliamentary_election_rules where game_id=$1',[game]);
 assert.equal(rows.find(r=>r.id===b).status,'superseded');
 assert.equal(rows.find(r=>r.id===c).status,'draft');
 assert(await open(c));
 const insertR=async method=>(await q('insert into regional_election_rules(game_id,method,proposed_by) values($1,$2,$3) returning id',[game,method,teacher]))[0].id;
 const ra=await insertR('random'),rb=await insertR('agreement');
 const openR=async id=>(await q('select public.open_regional_rule_vote($1) as id',[id]))[0].id;
 const rv=await openR(ra);assert(rv);
 assert.match((await q('select body from game_votes where id=$1',[rv]))[0].body,/Способ распределения субъектов Российской Федерации: Жеребьёвка\\./);assert.equal(await openR(rb),null);
 await q("update game_votes set status='closed',result_code='no_quorum' where id=$1",[rv]);
 const retry=(await q('select status,vote_id from regional_election_rules where id=$1',[ra]))[0];
 assert.equal(retry.status,'vote_open');assert.notEqual(retry.vote_id,rv);
 const concurrent=await q("select procedure_key,count(*)::integer total from game_votes where status='open' group by procedure_key");
 assert(concurrent.every(r=>r.total===1));
 await db.exec("set request.jwt.claim.sub='"+student+"';");
 await assert.rejects(()=>q("select public.reopen_ksrf_question($1,'regional_system',$2)",[game,'Обнаружена ошибка процедуры голосования']),/только преподаватель/);
 console.log('PASS KSRF alternatives, automatic queue, no-quorum retry, teacher reset and access control');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
