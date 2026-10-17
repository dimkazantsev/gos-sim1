/* Isolated PGlite regression for stage-4 split-mandate staffing.
 * Runs actual migration; preserves ministry-only exclusivity and appointment roles.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261018033000_committee_mandate_distributions.sql','utf8');
assert(sql.includes("ON public.institution_assignments(game_id,user_id) WHERE unit_kind='ministry'"));
assert(sql.includes("pg_advisory_xact_lock"));
assert(sql.includes("Не в каждом комитете распределено ровно 90 мандатов"));
assert(sql.includes("on conflict(unit_id,user_id) do update"));
const uuid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 const game=uuid(1),partyA=uuid(2),partyB=uuid(3),head=uuid(100),leaderA=uuid(101),leaderB=uuid(120);
 try{
  await db.exec([
   'create schema auth;create schema private;create role anon;create role authenticated;',
   'create table identity(actor uuid,teacher boolean);',
   'insert into identity values(null,false);',
   'create function auth.uid() returns uuid language sql stable as $x$select actor from identity$x$;',
   'create function private.is_game_member(uuid) returns boolean language sql stable as $x$select actor is not null from identity$x$;',
   'create function private.is_game_observer(uuid) returns boolean language sql stable as $x$select false$x$;',
   'create function private.is_game_teacher(uuid) returns boolean language sql stable as $x$select teacher from identity$x$;',
   'create function private.game_role(uuid,uuid) returns text language sql stable as $x$select \'\'::text$x$;',
   'create table game_members(game_id uuid,user_id uuid,kind text,team text,joined_at timestamptz,roster_archived_at timestamptz);',
   'create table game_parties(id uuid primary key,game_id uuid,name text,leader_user_id uuid,color text);',
   'create table party_member_mandates(game_id uuid,party_id uuid,user_id uuid,base_mandates integer,effective_mandates integer);',
   'create function private.member_party_id(p_game uuid,p_user uuid) returns uuid language sql stable as $x$select p.id from game_parties p join game_members m on m.game_id=p.game_id and m.team=p.name where m.game_id=p_game and m.user_id=p_user limit 1$x$;',
   'create function private.gd_member_capacity(p_game uuid,p_user uuid) returns integer language sql stable as $x$select coalesce((select effective_mandates from party_member_mandates where game_id=p_game and user_id=p_user),0)$x$;',
   'create table institution_units(id uuid primary key,game_id uuid,unit_kind text,unit_key text,title text,description text,mandate_capacity integer,head_user_id uuid,capacity_min int,capacity_max int);',
   'create table institution_assignments(id uuid primary key default gen_random_uuid(),game_id uuid,unit_id uuid,unit_kind text,user_id uuid,party_id uuid,assignment_role text default \'member\',created_by uuid,created_at timestamptz default now(),constraint institution_assignments_unit_id_user_id_key unique(unit_id,user_id),constraint institution_assignments_game_id_user_id_unit_kind_key unique(game_id,user_id,unit_kind));'
  ].join('\n'));
  const who=async(uid,teacher=false)=>db.query('update identity set actor=$1,teacher=$2',[uid,teacher]);
  await db.query('insert into game_parties values($1,$2,\'Альфа\',$3,\'#3366aa\'),($4,$2,\'Бета\',$5,\'#339966\')',[partyA,game,leaderA,partyB,leaderB]);
  const citizens=[];
  for(let i=0;i<40;i++){
   const user=uuid(100+i),p=i<20?partyA:partyB,team=i<20?'Альфа':'Бета',seats=i%20<5?12:11;
   citizens.push({user,party:p,seats});
   await db.query('insert into game_members values($1,$2,\'student\',$3,now(),null)',[game,user,team]);
   await db.query('insert into party_member_mandates values($1,$2,$3,$4,$4)',[game,p,user,seats]);
  }
  const units=[];
  for(let i=0;i<5;i++){
   const id=uuid(200+i);units.push(id);
   await db.query('insert into institution_units(id,game_id,unit_kind,unit_key,title,mandate_capacity,head_user_id) values($1,$2,\'committee\',$3,$4,90,$5)',[id,game,'committee-'+i,'Комитет '+i,head]);
  }
  const minister=uuid(500),minister2=uuid(501);
  for(const uid of [minister,minister2]){
    await db.query("insert into institution_units(id,game_id,unit_kind,unit_key,title,head_user_id) values($1,$2,'ministry','m-'+$3,$4,$5)",[uid,game,uid,'Министерство',head]);
  }
  await db.query("insert into institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by) values($1,$2,'committee',$3,$4,'head',$3)",[game,units[0],head,partyA]);
  await db.exec(sql);
  await who(head,true);
  const matrix=(await db.query('select public.get_committee_matrix($1) as m',[game])).rows[0].m;
  assert.equal(matrix.filter(r=>r.quota===45).length,10,'Five committees have 45 seats for each faction');
  const caps=(await db.query('select public.get_committee_member_capacities($1) as m',[game])).rows[0].m;
  assert.equal(caps.length,40);
  assert.equal(caps.reduce((n,x)=>n+x.capacity,0),450);
  const alloc=async(u,person,n)=>db.query('select public.allocate_committee_mandates($1,$2,$3)',[u,person,n]);
  // Split the entire personal mandate package among all five committees.
  for(const person of citizens){
    const j=(Number(person.user.slice(-12)) - 100)%20;
    for(let i=0;i<5;i++){
      const extra=j<5?(i===j%5||i===(j+1)%5?1:0):(i===j%5?1:0);
      await alloc(units[i],person.user,2+extra);
    }
  }
  const totals=(await db.query("select unit_id,sum(mandates_allocated)::int as total from institution_assignments where unit_kind='committee' group by unit_id order by unit_id")).rows;
  for(const item of totals)assert.equal(item.total,90,'Every committee has exactly 90 mandates');
  const unique=(await db.query("select user_id,sum(mandates_allocated)::int s from institution_assignments where unit_kind='committee' group by user_id")).rows;
  for(const person of citizens)assert.equal(unique.find(x=>x.user_id===person.user).s,person.seats);
  const kept=(await db.query('select assignment_role from institution_assignments where unit_id=$1 and user_id=$2',[units[0],head])).rows[0].assignment_role;
  assert.equal(kept,'head','Chair role not overwritten');
  const failed=async(fn,regex,label)=>{await assert.rejects(fn,regex,label)};
  await failed(()=>alloc(units[0],citizens[0].user,40),/Превышено|квота/i,'Cannot exceed personal package');
  await failed(()=>alloc(units[0],citizens[0].user,-1),/Некорректное/i,'Negative allocation refused');
  await who(leaderA,false);
  await failed(()=>alloc(units[0],citizens[21].user,3),/фракции/i,'Faction leader cannot assign competing faction');
  await who(head,true);
  await failed(()=>db.query('select public.remove_institution_member($1)',[(await db.query('select id from institution_assignments where unit_id=$1 and user_id=$2',[units[0],head])).rows[0].id]),/председатель/i,'Cannot remove elected committee chair');
  const ministryA=await db.query('select public.assign_institution_member($1,$2)',[minister,citizens[0].user]);
  await db.query('select public.assign_institution_member($1,$2)',[minister2,citizens[0].user]);
  const ministryRows=await db.query("select unit_id from institution_assignments where game_id=$1 and user_id=$2 and unit_kind='ministry'",[game,citizens[0].user]);
  assert.equal(ministryRows.rows.length,1,'Ministry remains a single appointment per person');
  assert.equal(ministryRows.rows[0].unit_id,minister2);
  console.log('PASS split committee mandates: 40 deputies, 450/450 across five 90-seat committees, 10 party quotas, personal limits, chair role, leader rights, removal guard and ministry exclusivity.');
 }finally{await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
