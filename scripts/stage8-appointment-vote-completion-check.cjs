const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261020095000_presidential_appointment_vote_completion_guard.sql','utf8');
const ui=fs.readFileSync('components/game/VotesView.tsx','utf8');
const ast=ts.createSourceFile('VotesView.tsx',ui,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length,0);
assert(ui.includes("registered.some(r=>!ballots.some(b=>b.vote_id===v.id&&b.voter_id===r.user_id))"));
assert(ui.includes('if(!checkinLoaded)return false'));
assert(ui.includes('if(teacher)return true'));
assert(sql.includes("'v_body,''president_act'',2,'"));
assert(sql.includes("private.formal_workflow('president_act')->2->>'code' IS DISTINCT FROM 'signed'"));
assert(sql.includes("private.vote_eligible_weight(v,r.user_id)>0"));
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  const fixture=[
 "CREATE SCHEMA auth; CREATE SCHEMA private;",
 "CREATE TABLE government_nominations(id uuid primary key,game_id uuid,office_kind text,candidate_name text,office_title text,appointment_document_id uuid);",
 "CREATE TABLE game_votes(id uuid primary key,game_id uuid,stage_no integer,institution_key text,procedure_key text,status text,formal_document_id uuid,electorate_snapshot jsonb);",
 "CREATE TABLE game_ballots(vote_id uuid,voter_id uuid);",
 "CREATE TABLE institution_session_registrations(game_id uuid,stage_no integer,institution_key text,user_id uuid);",
 "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.test_uid',true),'')::uuid $$;",
 "CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;",
 "CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('app.teacher',true),'off')='on' $$;",
 "CREATE FUNCTION private.can_close_procedural_vote(uuid,uuid,text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;",
 "CREATE FUNCTION private.vote_eligible_weight(v game_votes,u uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT coalesce((v.electorate_snapshot->'weights'->>u::text)::numeric,0) $$;",
 "CREATE FUNCTION private.finalize_procedural_vote(p_vote_id uuid,p_note text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN UPDATE game_votes SET status='closed' WHERE id=p_vote_id; RETURN jsonb_build_object('result','closed'); END $$;",
 "CREATE FUNCTION private.formal_workflow(p_key text) RETURNS jsonb LANGUAGE sql AS $$ SELECT CASE WHEN p_key='president_act' THEN '[{\"code\":\"draft\"},{\"code\":\"review\"},{\"code\":\"signed\"},{\"code\":\"published\"}]'::jsonb ELSE '[{\"code\":\"draft\"},{\"code\":\"review\"},{\"code\":\"published\"}]'::jsonb END $$;",
 "CREATE FUNCTION private.stage8_create_formal_document(uuid,text,text,text,text,text,text,integer,jsonb) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN IF $3='president_decree' AND ($7<>'president_act' OR $8<>2) THEN RAISE EXCEPTION 'Invalid document route'; END IF; RETURN '10000000-0000-0000-0000-000000000099'::uuid; END $$;",
 "CREATE FUNCTION private.stage8_create_appointment_decree(p_nomination_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE n government_nominations%rowtype; v_body text:='Указ';v_title text;v_doc uuid; BEGIN SELECT * INTO n FROM government_nominations WHERE id=p_nomination_id; IF n.office_kind='central_bank_chair' then return null; END IF; IF n.appointment_document_id is not null then return n.appointment_document_id; END IF; v_title:='Назначить'; v_doc:=private.stage8_create_formal_document(n.game_id,v_title,'president_decree','president','Президент',v_body,'president_decree',2,'{}'::jsonb); UPDATE government_nominations SET appointment_document_id=v_doc WHERE id=p_nomination_id; RETURN v_doc; END $$;",
 "CREATE FUNCTION public.close_procedural_vote(p_vote_id uuid,p_note text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $function$ DECLARE uid uuid:=auth.uid();v game_votes%rowtype; BEGIN SELECT * INTO v FROM game_votes WHERE id=p_vote_id FOR UPDATE; IF v.id IS NULL OR uid IS NULL OR NOT private.is_game_member(v.game_id) THEN RAISE EXCEPTION 'Нет доступа'; END IF; IF NOT private.can_close_procedural_vote(v.game_id,uid,v.institution_key,v.formal_document_id) AND NOT EXISTS(SELECT 1 WHERE false) THEN RAISE EXCEPTION 'Нет прав'; END IF; return private.finalize_procedural_vote(p_vote_id,p_note); END $function$;"
 ].join('\n');
 await db.exec(fixture);
 await db.exec(sql);
 const g=id(1),a=id(2),b=id(3),chief=id(4),nom=id(5),vote=id(6),vote2=id(7);
 await db.query("INSERT INTO government_nominations(id,game_id,office_kind,candidate_name,office_title) VALUES($1,$2,'prime_minister','Тестов','Председатель Правительства')",[nom,g]);
 const one=await db.query('SELECT private.stage8_create_appointment_decree($1) doc',[nom]);
 assert.equal(one.rows[0].doc,id(99));
 assert.equal((await db.query('SELECT private.stage8_create_appointment_decree($1) doc',[nom])).rows[0].doc,id(99));
 const snap=JSON.stringify({attendance_required:true,weights:{[a]:225,[b]:225}});
 await db.query("INSERT INTO game_votes(id,game_id,stage_no,institution_key,procedure_key,status,electorate_snapshot) VALUES($1,$2,8,'gd','government_nomination','open',$3::jsonb),($4,$2,8,'gd','government_nomination','open',$3::jsonb)",[vote,g,snap,vote2]);
 await db.query("INSERT INTO institution_session_registrations VALUES($1,8,'gd',$2),($1,8,'gd',$3)",[g,a,b]);
 await db.exec("SELECT set_config('app.test_uid','"+chief+"',false)");
 await db.query("INSERT INTO game_ballots VALUES($1,$2)",[vote,a]);
 await assert.rejects(()=>db.query('SELECT close_procedural_vote($1,NULL)',[vote]),/ещё не все зарегистрированные/);
 assert.equal((await db.query('SELECT status FROM game_votes WHERE id=$1',[vote])).rows[0].status,'open');
 await db.query("INSERT INTO game_ballots VALUES($1,$2)",[vote,b]);
 await db.query('SELECT close_procedural_vote($1,NULL)',[vote]);
 assert.equal((await db.query('SELECT status FROM game_votes WHERE id=$1',[vote])).rows[0].status,'closed');
 await assert.rejects(()=>db.query('SELECT close_procedural_vote($1,NULL)',[vote2]),/ещё не все зарегистрированные/);
 await db.exec("SELECT set_config('app.teacher','on',false)");
 await db.query('SELECT close_procedural_vote($1,NULL)',[vote2]);
 assert.equal((await db.query('SELECT status FROM game_votes WHERE id=$1',[vote2])).rows[0].status,'closed');
 console.log('PASS: presidential signed act route and repeat, 225+225 ballots, premature manual close prevented, teacher exception, UI');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
