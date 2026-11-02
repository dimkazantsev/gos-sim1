const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261102165000_remove_case_meta_framing.sql','utf8');
const followup=fs.readFileSync('supabase/migrations/20261102166000_remove_northern_supply_meta_clause.sql','utf8');
const cases=[...sql.matchAll(/\('([^']+)','([^']+)','([^']+)'\)/g)].map(([,key,oldStart,newStart])=>({key,oldStart,newStart}));
assert.equal(cases.length,19,'There must be 19 exact regional declension corrections');
assert.equal(new Set(cases.map(x=>x.key)).size,cases.length,'No repeated case keys');
for(const item of cases) {
 assert(item.oldStart.startsWith('В вымышленном сценарии '));
 assert(item.newStart.startsWith('В ')&&!/вымышлен|учебн/i.test(item.newStart));
}
const jsonPaths=['content/budget-regional-events-2026.json','content/budget-cases-2026.json'];
for(const path of jsonPaths) {
 const parsed=JSON.parse(fs.readFileSync(path,'utf8'));
 assert(parsed,'JSON must remain valid: '+path);
}
const regional=fs.readFileSync('content/budget-regional-events-2026.json','utf8');
const legal=fs.readFileSync('content/legal-cases-october.tsv','utf8');
const budget=fs.readFileSync('content/budget-cases-2026.json','utf8');
const workspace=fs.readFileSync('components/game/BudgetRegionWorkspace.tsx','utf8');
assert(!regional.includes('Учебная карта подтопления')&&!regional.includes('Учебный реестр обязательств'));
assert(!legal.includes('Для учебного сценария')&&!legal.includes('В учебном сценарии'));
assert(!budget.includes('учебного финансового периода')&&!budget.includes('Учебная оценка недоступной части'));
assert(!workspace.includes('Региональные суммы — игровые сценарии'));
assert(regional.includes('вымышленных выпускников'),'Actual fictitious graduation fraud must retain its meaning');
(async()=>{
 const db=new PGlite();
 try {
  await db.exec('create table public.event_cases (case_key text primary key, situation text not null, decision_options jsonb, effect_plan jsonb)');
  const original=new Map();
  for(const {key,oldStart} of cases) {
   const body=oldStart+' проводится оценка. Финансирование — 900 млн ₽; доля региона — 240 млн ₽.';
   original.set(key,body);
   await db.query('insert into event_cases(case_key,situation,decision_options,effect_plan) values($1,$2,$3,$4)',[key,body,JSON.stringify({v:'remain'}),JSON.stringify({score:4})]);
  }
  const exceptions=[
   ['bank-legal-2026-086','Для учебного сценария Донецкой Народной Республики выделена целевая помощь. В учебном соглашении определены цели.'],
   ['bank-legal-2026-010','В Карелии учтён договор. В учебном реестре указаны участки.'],
   ['budget-region-2026-39-credit-return','Кредит возвращается в конце учебного финансового периода.'],
   ['budget-risk-2026-external','В вымышленном сценарии рублевый курс валюты долга увеличился на 15 %.'],
   ['bank-curated-light-09','Спектакль с вымышленными отказами в центре услуг — часть обстоятельств.'],
   ['budget-region-2026-14-credit','График возврата согласован. В вымышленном сценарии своевременный завоз сохраняет работу нескольких предприятий; ошибка учета затрудняет следующий заем.']
  ];
  for(const [key,body] of exceptions)await db.query('insert into event_cases(case_key,situation) values($1,$2)',[key,body]);
  await db.exec(sql);
  await db.exec(followup);
  for(const {key,oldStart,newStart} of cases){
   const row=(await db.query('select situation,decision_options,effect_plan from event_cases where case_key=$1',[key])).rows[0];
   assert.equal(row.situation,newStart+original.get(key).slice(oldStart.length),'Only fictional framing may change for '+key);
   assert.equal(row.decision_options.v,'remain');
   assert.equal(row.effect_plan.score,4);
  }
  const altered=(await db.query("select case_key,situation from event_cases where case_key like 'bank-%' or case_key like 'budget-risk%' or case_key like '%credit-return%' order by case_key")).rows;
  const mapped=new Map(altered.map(x=>[x.case_key,x.situation]));
  assert(mapped.get('bank-legal-2026-086').startsWith('В Донецкой Народной Республике выделена целевая помощь. В соглашении'));
  assert(mapped.get('bank-legal-2026-010').includes('В реестре указаны участки'));
  assert(mapped.get('budget-region-2026-39-credit-return').includes('в конце финансового периода'));
  assert(mapped.get('budget-risk-2026-external').includes('Рублёвый курс валюты долга увеличился на 15 %'));
  assert(mapped.get('bank-curated-light-09').includes('вымышленными отказами'));
  const northern=(await db.query("select situation from event_cases where case_key='budget-region-2026-14-credit'")).rows[0].situation;
  assert(northern.includes('Своевременный завоз сохраняет работу нескольких предприятий; ошибка учёта затрудняет следующий заём.'));
  assert(!northern.includes('вымышленном сценарии'));

  const snapshot=(await db.query('select case_key,situation from event_cases order by case_key')).rows;
  await db.exec(sql);
  await db.exec(followup);
  assert.deepEqual((await db.query('select case_key,situation from event_cases order by case_key')).rows,snapshot,'Migration must be idempotent');
  console.log('PASS: 24 situation rewrites; all grammatical openings, values, decisions and legitimate fictional details preserved; migration idempotent');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
