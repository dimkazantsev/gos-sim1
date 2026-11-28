import type {FormalDocument,FormalStep,Vote} from './types';

export function isGovernmentAgenda(d:FormalDocument){
 return d.doc_type==='meeting_agenda'&&d.subject_key==='government'&&d.metadata?.document_kind==='government_session_agenda';
}
export function governmentAgendaVotes(votes:Vote[]){
 const result=new Map<string,Vote>();
 for(const v of votes){
  if(v.procedure_key!=='government_agenda'||v.institution_key!=='government'||v.stage_no!==11||!v.formal_document_id||v.result_code==='superseded')continue;
  const old=result.get(v.formal_document_id);
  if(!old||v.opened_at>old.opened_at)result.set(v.formal_document_id,v);
 }
 return result;
}
const agendaSteps:FormalStep[]=[
 {code:'draft',label:'Подготовка повестки',owner:'government',action:null},
 {code:'signed',label:'Подписание Председателем Правительства',owner:'government',action:null},
 {code:'agenda_vote',label:'Утверждение голосованием Правительства',owner:'government',action:null},
 {code:'published',label:'Повестка утверждена и опубликована',owner:'system',action:null}
];
export function documentRoute(d:FormalDocument,vote?:Vote){
 if(isGovernmentAgenda(d)&&!['rejected','superseded','withdrawn'].includes(d.status_code)){
  const signed=d.status_code==='published';
  const linked=vote?.formal_document_id===d.id&&vote.game_id===d.game_id&&vote.stage_no===d.stage_no&&vote.procedure_key==='government_agenda'&&vote.institution_key==='government'&&vote.body===d.body_text?vote:undefined;
  const passed=signed&&linked?.status==='closed'&&linked.result_code==='passed'&&linked.result_quorum_met===true;
  const step=passed?3:signed?2:0;
  const status=passed?'Повестка утверждена':signed?linked?.status==='open'?'Идёт голосование за повестку':linked?.status==='closed'?'Повестка не утверждена — '+(linked.result_label||'голосование завершено'):'Повестка подписана — ожидает голосования':'Повестка ожидает подписания';
  return {steps:agendaSteps,step,progress:passed?100:signed?67:0,status,owner:passed?'system':'government',vote:linked,governmentAgenda:true};
 }
 const steps=d.workflow_steps;
 const publishedIndex=d.status_code==='published'?steps.findIndex(s=>s.code==='published'):-1;
 const step=Math.max(0,Math.min(Math.max(0,steps.length-1),publishedIndex>=0?publishedIndex:d.current_step));
 return {steps,step,progress:Math.round(step/Math.max(1,steps.length-1)*100),status:d.status_label,owner:d.current_owner_key,vote:undefined,governmentAgenda:false};
}
