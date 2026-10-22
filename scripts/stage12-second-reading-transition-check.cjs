'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();try{
 await db.exec(`CREATE SCHEMA private;
 CREATE TABLE public.games(id integer);
 CREATE TABLE public.formal_documents(id integer PRIMARY KEY,game_id integer,stage_no integer,workflow_key text,doc_type text,status_code text,current_step integer,current_owner_key text,workflow_steps jsonb,body_text text,title text,metadata jsonb);
 CREATE TABLE public.bill_amendments(document_id integer,status text);
 CREATE TABLE public.bill_amendment_packs(document_id integer,status text);
 INSERT INTO public.games VALUES(1);
 INSERT INTO public.formal_documents VALUES(1,1,12,'bill','fz_bill','amendments',5,'committee','[]','Исходный текст','Тест','{}');
 INSERT INTO public.bill_amendments VALUES(1,'submitted');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261022182544_stage12_prepare_second_reading_with_amendments.sql','utf8'));
 await db.exec('CREATE TRIGGER guard_bill_amendment_document BEFORE UPDATE OR DELETE ON public.formal_documents FOR EACH ROW EXECUTE FUNCTION private.guard_bill_amendment_document()');
 for(const change of ["status_code='reading3',current_step=7,current_owner_key='gd'","status_code='rejected'","stage_no=11,status_code='reading2',current_step=6,current_owner_key='gd'","status_code='reading2',current_step=6,current_owner_key='president'","status_code='reading2',current_step=6,current_owner_key='gd',workflow_steps='[1]'","status_code='reading2',current_step=6,current_owner_key='gd',game_id=2","status_code='reading2',current_step=6,current_owner_key='gd',doc_type='fkz_bill'","status_code='reading2',current_step=6,current_owner_key='gd',workflow_key=NULL"])
  await assert.rejects(()=>db.exec('UPDATE public.formal_documents SET '+change),/все поправки/);
 await db.exec("INSERT INTO public.bill_amendment_packs VALUES(1,'voting')");
 await assert.rejects(()=>db.exec("UPDATE public.formal_documents SET status_code='reading2',current_step=6,current_owner_key='gd'"),/все поправки/);
 await assert.rejects(()=>db.exec("UPDATE public.formal_documents SET body_text='Новый текст'"),/зафиксирован/);
 await db.exec('DELETE FROM public.bill_amendment_packs');
 await db.exec("UPDATE public.formal_documents SET status_code='reading2',current_step=6,current_owner_key='gd'");
 assert.equal((await db.query('SELECT status_code FROM public.formal_documents')).rows[0].status_code,'reading2');
 await assert.rejects(()=>db.exec("UPDATE public.formal_documents SET status_code='reading3',current_step=7"),/все поправки/);
 await assert.rejects(()=>db.exec('DELETE FROM public.formal_documents'),/историей поправок/);
 await db.exec("UPDATE public.bill_amendments SET status='accepted'");
 await db.exec("UPDATE public.formal_documents SET status_code='reading3',current_step=7");
 console.log('PASS: submitted amendments enter second reading; skipping, foreign game/type/workflow, null bypass, active vote, frozen text, premature third reading and deletion remain forbidden.');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
