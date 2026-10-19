const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const ui=fs.readFileSync('components/game/PresidentialElectionLab.tsx','utf8');
const css=fs.readFileSync('app/stage6-cec-workspace-polish.css','utf8');
const sql=fs.readFileSync('supabase/migrations/20261019230000_preserve_cec_candidate_document_review.sql','utf8');
for(const fragment of [
 'className="cecSubmissionActions"','className="cecSubmittedDocuments"','className="cecSubmittedDocumentList"',
 "void downloadCandidateDoc(doc)","reviewCandidateDoc(doc,'accepted')","reviewCandidateDoc(doc,'revision')",
 "p_note:status==='revision'?note:null","doc.status==='revision'&&<p className=\"cecDocumentRevisionNotice\"",
 'doc.is_submitted','<a href={doc.url}'
])assert(ui.includes(fragment),'Missing CEC teacher document action: '+fragment);
for(const selector of ['#stage6-cec .cecSubmissionActions','#stage6-cec .cecSubmittedDocuments','#stage6-cec .cecDocumentReviewerNote','#stage6-cec .cecDocumentReviewerActions','@container cec-stage6 (max-width:490px)'])
 assert(css.includes(selector),'Missing responsive layout: '+selector);
assert(css.includes('.cecSubmissionActions{display:flex')&&css.includes('padding:17px 0 5px'),'Submission buttons must not touch document checklist');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE TABLE presidential_candidate_documents (status text,auto_check jsonb,note text,reviewed_by uuid);
   CREATE OR REPLACE FUNCTION public.record_presidential_cec_decision(p_candidate_id uuid,p_status text,p_legal_errors integer,p_rating_penalty numeric,p_public_summary text,p_private_summary text)
   RETURNS void LANGUAGE plpgsql AS $func$
   BEGIN
    UPDATE public.presidential_candidate_documents d SET
     status=case when coalesce(d.auto_check->>'verdict','manual')='issues' then 'revision' else d.status end,
     note=case when coalesce(d.auto_check->>'verdict','manual')='issues'
      then coalesce(nullif(d.auto_check->>'summary',''),'Требуется устранить замечания автоматической предварительной проверки.')
      else d.note end,
     reviewed_by=case when coalesce(d.auto_check->>'verdict','manual')='issues' then '10000000-0000-0000-0000-000000000001'::uuid else d.reviewed_by end;
   END;$func$;
  `);
  await db.exec(sql);
  await db.query("INSERT INTO presidential_candidate_documents VALUES('revision','{\"verdict\":\"issues\",\"summary\":\"Автоматическая проверка\"}','Преподаватель: исправить дату','10000000-0000-0000-0000-000000000002')");
  await db.query("INSERT INTO presidential_candidate_documents VALUES('accepted','{\"verdict\":\"issues\"}',NULL,'10000000-0000-0000-0000-000000000002')");
  await db.query("INSERT INTO presidential_candidate_documents VALUES('submitted','{\"verdict\":\"issues\",\"summary\":\"Автоматическое замечание\"}',NULL,NULL)");
  await db.query("SELECT public.record_presidential_cec_decision(NULL,NULL,NULL,NULL,NULL,NULL)");
  const rows=(await db.query('SELECT status,note,reviewed_by FROM presidential_candidate_documents ORDER BY status,note NULLS FIRST')).rows;
  const remark=rows.find(x=>x.note==='Преподаватель: исправить дату');
  assert(remark&&remark.status==='revision'&&remark.reviewed_by==='10000000-0000-0000-0000-000000000002','Teacher remarks survive official candidate decision');
  assert(rows.some(x=>x.status==='accepted'&&x.reviewed_by==='10000000-0000-0000-0000-000000000002'),'Teacher accepted document stays accepted');
  assert(rows.some(x=>x.note==='Автоматическое замечание'&&x.status==='revision'),'Unreviewed document still gets automatic finding');
  console.log('PASS: teacher can open/download/review submitted files; reviewer notes and manual status survive CEC decision; checklist buttons separated and mobile styles provided.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
