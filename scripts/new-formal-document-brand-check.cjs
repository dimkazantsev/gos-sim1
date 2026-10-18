const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync('supabase/migrations/20261018195000_new_formal_document_gos_id_brand.sql','utf8');
const required=[
 'private.presidential_system_vote_trigger',
 'private.refresh_government_agenda_document',
 'private.stage4_result_act',
 'private.stage8_create_formal_document',
 'private.sync_duma_session_agenda_document',
 'private.sync_reviewed_crisis_legal_act',
 'private.sync_verified_vote_decision_act',
 'public.create_formal_document',
 'public.propose_presidential_system',
 'public.save_institution_meeting_document',
];
for(const name of required)assert(source.includes("'"+name+"'"),'Generator not covered: '+name);
assert.match(source,/replaced<>array_length\(expected,1\)/,'No partial rebranding allowed');
const insertHook=source.split('-- NEW_REGISTRY_BRAND_TRIGGER')[1];
assert(insertHook&&insertHook.includes('BEFORE INSERT ON public.formal_documents'));
assert(!insertHook.includes('BEFORE UPDATE'),'Historical document IDs cannot be rewritten');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec("CREATE SCHEMA private;CREATE ROLE anon;CREATE ROLE authenticated;"+
    "CREATE TABLE public.formal_documents(id integer generated always as identity PRIMARY KEY,"+
    "registry_no text NOT NULL,title text,body_text text);");
  await db.query("INSERT INTO public.formal_documents(registry_no,title,body_text) VALUES('ИГРА-НПА-0167','Старый протокол','Исторический текст'),('ИГРА-НПА-0175','Старый протокол','Исторический текст')");
  await db.exec(insertHook);
  const types=['НПА','ПГД','УК','ПОВ','ПОВ-ГД','РЕШ','КР','ЗАС','МСУ'];
  await Promise.all(Array.from({length:40},(_,i)=>{
    const prefix=i%3===0?'ИГРА-':i%3===1?'игра-':'Игра-';
    const serial=String(i+1).padStart(4,'0');
    return db.query('INSERT INTO public.formal_documents(registry_no,title,body_text) VALUES($1,$2,$3)',[
      prefix+types[i%types.length]+'-'+serial,'Документ №'+i,'Текст, в котором слово ИГРА упомянуто осмысленно'
    ]);
  }));
  await db.query("INSERT INTO public.formal_documents(registry_no,title) VALUES('ГОС.ID-НПА-2000','Новый документ')");
  const records=(await db.query('SELECT registry_no,title,body_text FROM public.formal_documents ORDER BY id')).rows;
  assert.equal(records.length,43);
  assert.deepEqual(records.slice(0,2).map(d=>d.registry_no),['ИГРА-НПА-0167','ИГРА-НПА-0175'],'Old numbers preserved byte-for-byte');
  assert.equal(records.filter(d=>d.registry_no.startsWith('ГОС.ID-')).length,41,'All 40 concurrent new docs use current brand');
  assert(records.slice(2).every(d=>!/^игра-/i.test(d.registry_no)),'No newly inserted old prefix');
  assert(records.slice(2).every(d=>d.title),'Document titles intact');
  assert(records.slice(2,42).every(d=>d.body_text==='Текст, в котором слово ИГРА упомянуто осмысленно'),'Do not rewrite substantive submitted text');
  await db.query("UPDATE public.formal_documents SET title='Редакция старого протокола' WHERE registry_no='ИГРА-НПА-0167'");
  assert.equal((await db.query("SELECT registry_no FROM public.formal_documents WHERE title='Редакция старого протокола'")).rows[0].registry_no,'ИГРА-НПА-0167','Old number remains unchanged even when document is edited');
  const triggers=(await db.query("SELECT tgname FROM pg_trigger WHERE tgrelid='public.formal_documents'::regclass AND NOT tgisinternal")).rows;
  assert.equal(triggers.filter(t=>t.tgname==='brand_new_formal_document_registry').length,1,'One insert-only safeguard');
  console.log('PASS: ten generators covered; 40 simultaneous new IDs corrected to ГОС.ID; old IDs and document contents untouched; trigger only on INSERT.');
 } finally {await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
