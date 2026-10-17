const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261018031000_multi_committee_mandate_allocations.sql','utf8');
const ui=fs.readFileSync('components/game/InstitutionStaffingLab.tsx','utf8');
for(const token of ['pg_advisory_xact_lock','v_member_used-v_previous+p_mandates>v_capacity','v_unit_used-v_previous+p_mandates>coalesce(u.mandate_capacity,90)','v_faction_used-v_previous+p_mandates>v_quota','committee_mandates_allocated'])
 assert(sql.includes(token),'Missing database invariant: '+token);
assert(ui.includes('committee_mandate_allocations')&&ui.includes('get_committee_deputy_capacity'),'UI uses authoritative allocation and capacity');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 const game=id(1),teacher=id(99),a=id(10),b=id(11),partyA=id(20),partyB=id(21);
 try{
  await db.exec([
   'create schema auth; create schema private; create role anon; create role authenticated;',
   'create table auth.users(id uuid primary key);',
   'create publication supabase_realtime;',
   'create table acting(user_id uuid,teacher boolean);',
   'insert into acting values(null,false);',
   'create function auth.uid() returns uuid language sql stable as $a$select user_id from acting$a$;',
   'create function private.is_game_member(uuid) returns boolean language sql stable as $a$select user_id is not null from acting$a$;',
   'create function private.is_game_observer(uuid) returns boolean language sql stable as $a$select false$a$;',
   'create function private.is_game_teacher(uuid) returns boolean language sql stable as $a$select teacher from acting$a$;',
   'create function private.game_role(uuid,uuid) returns text language sql stable as $a$select null::text$a$;',
   'create table games(id uuid primary key);',
   'create table game_stages(game_id uuid,stage_no integer,status text);',
   'create table game_members(game_id uuid,user_id uuid,team text,kind text,joined_at timestamptz,roster_archived_at timestamptz);',
   'create table game_parties(id uuid primary key,game_id uuid,name text,registration_status text,leader_user_id uuid,color text);',
   'create table party_member_mandates(game_id uuid,user_id uuid,party_id uuid,base_mandates integer,effective_mandates integer);',
   'create table simulated_deputy_seats(game_id uuid,user_id uuid,seats integer);',
   'create table institution_units(id uuid primary key,game_id uuid,unit_kind text,unit_key text,title text,mandate_capacity integer,head_user_id uuid);',
   'create table institution_assignments(id uuid primary key default gen_random_uuid(),game_id uuid,unit_id uuid,unit_kind text,user_id uuid,party_id uuid,assignment_role text,created_by uuid,created_at timestamptz default now(),unique(game_id,user_id,unit_kind),unique(unit_id,user_id));',
   'create table office_elections(game_id uuid,stage_no integer,office_key text,status text);',
   'create function private.member_party_id(g uuid,u uuid) returns uuid language sql stable as $p$select p.id from game_parties p join game_members gm on gm.game_id=p.game_id and gm.team=p.name where p.game_id=g and gm.user_id=u limit 1$p$;',
   "create function private.gd_member_capacity(g uuid,u uuid) returns integer language sql stable as $c$select coalesce((select seats from simulated_deputy_seats where game_id=g and user_id=u),0)$c$;"
  ].join('\n'));
  await db.query('insert into auth.users values($1),($2),($3)',[a,b,teacher]);
  await db.query('insert into games values($1)',[game]);
  await db.query("insert into game_stages values($1,4,'open')",[game]);
  await db.query('insert into game_parties(id,game_id,name,registration_status,leader_user_id) values($1,$2,$3,$4,$5),($6,$2,$7,$4,$8)',[partyA,game,'ЛДПР','registered',a,partyB,'Рама',b]);
  for(const [user,name] of [[a,'ЛДПР'],[b,'Рама']]){
   await db.query("insert into game_members values($1,$2,$3,'student',now(),null)",[game,user,name]);
   await db.query('insert into simulated_deputy_seats values($1,$2,225)',[game,user]);
  }
  const units=[];
  for(let n=0;n<5;n++){
   const u=id(30+n);units.push(u);
   await db.query("insert into institution_units values($1,$2,'committee',$3,$4,90,$5)",[u,game,'committee'+n,'Комитет '+n,a]);
  }
  for(const k of ['gd_chair','gd_deputy_1','gd_deputy_2'])await db.query("insert into office_elections values($1,4,$2,'finished')",[game,k]);
  await db.exec(sql);
  const actor=async(user,teacherMode)=>db.query('update acting set user_id=$1,teacher=$2',[user,teacherMode]);
  const put=async(u,user,mandates)=>db.query('select public.set_committee_mandates($1,$2,$3)',[u,user,mandates]);
  const count=async()=>(await db.query('select coalesce(sum(mandates),0)::integer n from committee_mandate_allocations where game_id=$1',[game])).rows[0].n;
  const matrix=async()=>(await db.query('select public.get_committee_matrix($1) m',[game])).rows[0].m;
  const ready=async()=>(await db.query('select private.stage_readiness_json($1,4) v',[game])).rows[0].v;
  async function rejects(f,label){let failed=false;try{await f()}catch(e){failed=true}assert(failed,label)}
  await actor(teacher,true);
  const capacity=(await db.query('select public.get_committee_deputy_capacity($1) c',[game])).rows[0].c;
  assert.equal(capacity.length,2);assert.equal(capacity[0].mandates+capacity[1].mandates,450);
  assert((await matrix()).every(row=>row.quota===45),'Quota balances two parties');
  await put(units[0],a,45);
  await rejects(()=>put(units[0],b,46),'Quota limits excess');
  await actor(b,false);
  await rejects(()=>put(units[1],a,5),'Other-faction leader cannot allocate');
  await actor(a,false);await put(units[1],a,45);
  await actor(teacher,true);
  for(let i=2;i<5;i++)await put(units[i],a,45);
  for(const u of units)await put(u,b,45);
  assert.equal(await count(),450,'All 450 seats allocated');
  assert((await matrix()).every(row=>row.assigned_mandates===45));
  assert.equal((await ready()).ready,true,'Stage 4 finished readiness means 450/450');
  await rejects(()=>put(units[0],a,90),'Member quota prevents overbooking');
  await put(units[4],b,0);
  assert.equal(await count(),405);assert.equal((await ready()).ready,false,'Removal revokes readiness');
  await put(units[4],b,45);assert.equal((await ready()).ready,true);
  // 224+226 mandate factions must receive exactly their overall allocation;
  // naive equal rounding in every committee would create 225+225 instead.
  await db.query('update simulated_deputy_seats set seats=224 where game_id=$1 and user_id=$2',[game,a]);
  await db.query('update simulated_deputy_seats set seats=226 where game_id=$1 and user_id=$2',[game,b]);
  const irregular=await matrix();
  const sumParty=party=>irregular.filter(row=>row.party_id===party).reduce((sum,row)=>sum+row.quota,0);
  assert.equal(sumParty(partyA),224,'First party quota is 224 over all five committees');
  assert.equal(sumParty(partyB),226,'Second party quota is 226 over all five committees');
  for(const u of units)assert.equal(irregular.filter(row=>row.unit_id===u).reduce((sum,row)=>sum+row.quota,0),90,'Each committee still has 90 seats');
  assert.equal((await ready()).ready,false,'Previous 225/225 allocations do not satisfy changed personal quotas');
  await db.query("update game_stages set status='completed' where game_id=$1",[game]);
  await rejects(()=>put(units[0],a,1),'Closed stage is immutable');
  console.log('PASS stage4 mandate allocations: 5x90, two registered parties, same deputies across 5 committees, quota, permissions, removal, readiness and frozen stage');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});