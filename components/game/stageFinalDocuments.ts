/** Document requirements are produced by private.stage_required_final_documents
 * through the same readiness RPC used to guard stage completion. */
export type StageFinalDocument={
 template_key:string;
 title:string;
 subject_key:string;
 fulfilled:boolean;
};
export function stageDocumentSubject(stageNo:number,templateKey:string,original:string){
 if(templateKey==='minutes'){
  if(stageNo===2||stageNo===3)return 'ksrf';
  if(stageNo===4||stageNo===5)return 'gd';
  if(stageNo===7)return 'sf';
  if(stageNo===11)return 'government';
 }
 if(stageNo===10&&templateKey==='financial_economic')return 'ministry';
 return original;
}
export function canPrepareStageFinalDocument(
 requirement:StageFinalDocument,
 subjects:readonly string[],
 teacher:boolean
){
 if(requirement.subject_key==='any'){
  return teacher||['president','government','ministry','municipality'].some(s=>subjects.includes(s));
 }
 return teacher||subjects.includes(requirement.subject_key);
}
export function crisisDocumentTemplate(subjects:readonly string[],teacher:boolean){
 if(subjects.includes('president'))return 'president_decree';
 if(subjects.includes('government'))return 'government_resolution';
 if(subjects.includes('ministry'))return 'ministry_order';
 if(subjects.includes('municipality'))return 'municipal_act';
 return teacher?'government_resolution':null;
}
