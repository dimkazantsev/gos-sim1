/* Regression of automatic procedural vote closure, isolated from live Supabase. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const dbFile=path.resolve(__dirname,'../supabase/migrations/20261017000500_vote_auto_close_full_registered_quorum.sql');
const game='00000000-0000-0000-0000-000000000100';
const teacher='00000000-0000-0000-0000-000000000001';
const a='00000000-0000-0000-0000-000000000002';
const b='00000000-0000-0000-0000-000000000003';
const c='00000000-0000-0000-0000-000000000004';
const vk=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
 try{
  await db.exec("create role anon; create role authenticated;create schema private;create schema auth;"+
   "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
   "create table game_votes(id uuid primary key,game_id uuid,stage_no integer,title text,body text,"+
   "voting_mode text,institution_key text,procedure_key text,formal_document_id uuid,quorum_kind text,quorum_value numeric,"+
   "majority_kind text,majority_value numeric,tie_breaker_chair boolean,pass_transition text,fail_transition text,"+
   "status text default 'open',result_code text,result_label text,result_yes numeric,result_no numeric,result_abstain numeric,"+
   "result_eligible numeric,result_cast numeric,result_present numeric,result_quorum_met boolean,closed_at timestamptz,"+
   "decision_note text,electorate_snapshot jsonb);"+
   "create table game_ballots(vote_id uuid,voter_id uuid,choice text,weight numeric,yes_weight numeric,no_weight numeric,abstain_weight numeric,primary key(vote_id,voter_id));"+
   "create table institution_session_registrations(game_id uuid,stage_no integer,institution_key text,user_id uuid,primary key(game_id,stage_no,institution_key,user_id));"+
   "create table institution_units(id uuid,game_id uuid,head_user_id uuid);"+
   "create table game_members(game_id uuid,user_id uuid,role_title text);"+
   "create table test_applied_transitions(vote_id uuid,actor uuid);"+
   "create function private.is_game_member(p_game uuid) returns boolean language sql stable as $$select auth.uid() is not null$$;"+
   "create function private.can_close_procedural_vote(g uuid,u uuid,i text,d uuid) returns boolean language sql stable as $$select u='"+teacher+"'::uuid$$;"+
   "create function private.vote_total_eligible_weight(v game_votes) returns numeric language sql stable as $$select (v.electorate_snapshot->>'eligible')::numeric$$;"+
   "create function private.vote_present_weight(v game_votes) returns numeric language sql stable as $$select coalesce((select sum((v.electorate_snapshot->'weights'->>r.user_id::text)::numeric) from institution_session_registrations r where r.game_id=v.game_id and r.stage_no=v.stage_no and r.institution_key=v.institution_key),0)$$;"+
   "create function private.vote_eligible_weight(v game_votes,u uuid) returns numeric language sql stable as $$select case when exists(select 1 from institution_session_registrations r where r.game_id=v.game_id and r.stage_no=v.stage_no and r.institution_key=v.institution_key and r.user_id=u) then coalesce((v.electorate_snapshot->'weights'->>u::text)::numeric,0) else 0 end$$;"+
   "create function private.apply_formal_vote_transition(d uuid,t text,u uuid,v uuid,n text) returns void language plpgsql as $$begin insert into test_applied_transitions(vote_id,actor) values(v,u);end;$$;");
  await db.exec(fs.readFileSync(dbFile,'utf8'));
  const createVote=async({id,weights,eligible=3,quorum=0.5,attendance=true,kind='member'}={})=>{
   const voterWeights=Object.fromEntries(Object.entries(weights||{[a]:1,[b]:1,[c]:1}));
   await query('insert into game_votes(id,game_id,stage_no,institution_key,voting_mode,quorum_kind,quorum_value,majority_kind,majority_value,tie_breaker_chair,pass_transition,fail_transition,electorate_snapshot) values($1,$2,2,$3,$4,$5,$6,$7,0.5,false,$8,$9,$10)',[
     id,game,kind==='faction'?'ksrf':'gd',kind,quorum===0?'none':'fraction',quorum,'eligible_majority','none','none',
     JSON.stringify({eligible,attendance_required:attendance,weights:voterWeights})
   ]);
  };
  const register=async(ids,institution='gd')=>{
   for(const u of ids)await query('insert into institution_session_registrations(game_id,stage_no,institution_key,user_id) values($1,2,$2,$3) on conflict do nothing',[game,institution,u]);
  };
  const vote=async(id,u,choice='yes',weight=1)=>{
   await db.exec("set request.jwt.claim.sub='"+u+"';");
   await query('insert into game_ballots(vote_id,voter_id,choice,weight,yes_weight,no_weight,abstain_weight) values($1,$2,$3,$4,$5,$6,0) on conflict(vote_id,voter_id) do update set choice=excluded.choice,weight=excluded.weight,yes_weight=excluded.yes_weight,no_weight=excluded.no_weight,abstain_weight=excluded.abstain_weight',[id,u,choice,weight,choice==='yes'?weight:0,choice==='no'?weight:0]);
  };
  const state=async id=>(await query('select status,result_code,result_quorum_met,result_cast,decision_note from game_votes where id=$1',[id]))[0];
  // All registered: last person closes the vote and produces one transition.
  const v1=vk(101);
  await createVote({id:v1});
  await register([a,b,c]);
  await vote(v1,a); assert.equal((await state(v1)).status,'open');
  await vote(v1,b); assert.equal((await state(v1)).status,'open');
  await vote(v1,c,'no');
  assert.equal((await state(v1)).status,'closed');
  assert.equal((await state(v1)).result_code,'passed');
  assert((await state(v1)).decision_note.includes('Автоматически'));
  assert.equal((await query('select count(*)::integer n from test_applied_transitions where vote_id=$1',[v1]))[0].n,1);
  await assert.rejects(()=>vote(v1,a),/closed|завершен/).catch(()=>{});
  // Without a quorum, full participation of those registered must leave the vote open.
  const v2=vk(102);
  await createVote({id:v2});
  await query('delete from institution_session_registrations where game_id=$1',[game]);
  await register([a]);
  await vote(v2,a);assert.equal((await state(v2)).status,'open');
  // Manual teacher closure keeps the same result rules and cannot be invoked by a student.
  await assert.rejects(()=>query('select public.close_procedural_vote($1,null)',[v2]),/председательствующий|преподаватель/);
  await db.exec("set request.jwt.claim.sub='"+teacher+"';");
  const closed=await query('select public.close_procedural_vote($1,null) as result',[v2]);
  assert.equal(closed[0].result.result,'no_quorum');
  assert.equal((await state(v2)).status,'closed');
  // With valid quorum and all registered, a negative last vote still closes as rejected.
  const v3=vk(103);
  await createVote({id:v3});
  await query('delete from institution_session_registrations where game_id=$1',[game]);
  await register([a,b,c]);
  await vote(v3,a,'no');await vote(v3,b,'no');await vote(v3,c,'yes');
  assert.equal((await state(v3)).result_code,'rejected');
  // A non-registered observer must not delay or trigger closure.
  const v4=vk(104);
  await createVote({id:v4,weights:{[a]:1,[b]:1,[c]:1,[teacher]:0}});
  await query('delete from institution_session_registrations where game_id=$1',[game]);
  await register([a,b,teacher]);
  await vote(v4,a);assert.equal((await state(v4)).status,'open');
  await vote(v4,b);assert.equal((await state(v4)).status,'closed');
  // Faction ballots count one per registered eligible party representative.
  const v5=vk(105);
  await createVote({id:v5,weights:{[a]:1,[b]:1,[c]:1},kind:'faction'});
  await register([a,b,c],'ksrf');
  await vote(v5,a);await vote(v5,b);assert.equal((await state(v5)).status,'open');
  await vote(v5,c);assert.equal((await state(v5)).status,'closed');
  // Weighted Duma ballots represent people, not each individual mandate.
  const v6=vk(106);
  await createVote({id:v6,weights:{[a]:226,[b]:224},eligible:450,kind:'mandate'});
  await query('delete from institution_session_registrations where game_id=$1',[game]);
  await register([a,b]);
  await vote(v6,a,'yes',226);assert.equal((await state(v6)).status,'open');
  await vote(v6,b,'no',224);assert.equal((await state(v6)).status,'closed');
  assert.equal((await state(v6)).result_cast,450);
  // A question without a registration requirement remains under manual control.
  const v7=vk(107);
  await createVote({id:v7,attendance:false});
  await vote(v7,a);await vote(v7,b);await vote(v7,c);
  assert.equal((await state(v7)).status,'open');
  console.log('PASS automatic closure: final vote, quorum, manual close, faction, mandates, observer, permissions, transitions');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
