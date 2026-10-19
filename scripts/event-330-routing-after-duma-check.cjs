const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261020083000_restore_approved_event_330_routing_after_duma.sql','utf8');
const css=fs.readFileSync('app/2026-npa-registry-canonical.css','utf8');
assert(sql.includes('duma_not_elected'));
assert(sql.includes("e.status=''adopted''"));
assert(sql.includes("status=''active''"));
assert(sql.includes('private.ensure_event_case_routing(p_game)'));
assert(sql.includes('ea.status=''pending'''));
assert(sql.includes('routing_not_configured'));
assert(sql.includes('for update skip locked'));
assert(css.includes('.legalPortal .registryCardHead>.formalStatus'));
assert(css.includes('flex-wrap:wrap!important'));
assert(css.includes('@media(max-width:850px)'));
assert(css.includes('grid-template-columns:minmax(0,1fr)!important'));
assert(css.includes('overflow-wrap:anywhere!important'));
(async()=>{
const db=new PGlite();
try{
 await db.exec(`
 CREATE SCHEMA private;
 CREATE TABLE private.authored_event_catalog(case_key text PRIMARY KEY);
 CREATE TABLE public.games(id uuid PRIMARY KEY);
 CREATE TABLE public.event_cases(id uuid PRIMARY KEY,game_id uuid,case_key text,audience text,status text);
 CREATE TABLE public.fiscal_region_reference(code text PRIMARY KEY);
 CREATE TABLE public.event_case_routing(game_id uuid,case_id uuid,earliest_stage integer,latest_stage integer,region_code text,destination text,requires_office boolean,competent_org text,PRIMARY KEY(game_id,case_id));
 `);
 const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
 const game=id(1),other=id(2);
 await db.query("INSERT INTO public.games VALUES($1),($2)",[game,other]);
 await db.exec("INSERT INTO public.fiscal_region_reference(code) SELECT lpad(i::text,2,'0') FROM generate_series(1,89) i");
 const cases=[];
 for(let i=1;i<=89;i++)cases.push('bank-legal-2026-'+String(i).padStart(2,'0'));
 for(let i=1;i<=24;i++)cases.push('budget-region-2026-'+String(i).padStart(2,'0')+'-sample');
 for(let i=1;i<=217;i++)cases.push('regular-case-'+String(i).padStart(3,'0'));
 assert.equal(cases.length,330);
 for(let i=0;i<cases.length;i++){
  await db.query('INSERT INTO private.authored_event_catalog VALUES($1)',[cases[i]]);
  await db.query("INSERT INTO public.event_cases VALUES($1,$2,$3,$4,'ready')",[id(1000+i),game,cases[i],i%3===0?'group':i%3===1?'all':'single']);
 }
 const body=sql.slice(0,sql.indexOf('REVOKE ALL ON FUNCTION'));
 await db.exec(body);
 const first=(await db.query("SELECT private.ensure_event_case_routing($1) added",[game])).rows[0].added;
 assert.equal(first,330);
 const result=(await db.query("SELECT count(*)::int total,count(*) FILTER(WHERE region_code IS NOT NULL)::int regional,min(earliest_stage)::int min_stage,max(latest_stage)::int max_stage,count(*) FILTER(WHERE competent_org IS NULL)::int empty_competence FROM public.event_case_routing WHERE game_id=$1",[game])).rows[0];
 assert.deepEqual(result,{total:330,regional:113,min_stage:6,max_stage:15,empty_competence:0});
 assert.equal((await db.query('SELECT private.ensure_event_case_routing($1) added',[game])).rows[0].added,0,'Second execution must be idempotent');
 assert.equal((await db.query('SELECT private.ensure_event_case_routing($1) added',[other])).rows[0].added,0,'Unknown game must not be seeded');
 assert.equal((await db.query('SELECT count(*)::int n FROM public.event_case_routing')).rows[0].n,330);
 console.log('PASS: 330 signed routes, 113 region-specific, competencies, stage >=6, isolation, idempotency, NPA responsive style');
}finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
