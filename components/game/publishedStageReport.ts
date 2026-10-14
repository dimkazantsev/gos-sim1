import type {FormalDocument,PoliticalPost,Vote} from './types';

/**
 * Read-only fallback for historic automatic stage messages until the editorial
 * migration is deployed. Never interpret an infinitive task as a completed act.
 * All statements below are derived from this game's publicly displayed records.
 */
export function publishedStageReport(
 post:PoliticalPost,
 documents:FormalDocument[],
 votes:Vote[]
):{title:string;body:string}|null{
 const stage=Number(post.context?.stage_no);
 if(post.context?.automatic!==true||
    post.context?.source_table!=='game_stages'||
    post.context?.editorial_verified===true||
    !post.source_key?.startsWith('stage:')||
    !post.source_key.includes(':completed:')||
    !Number.isInteger(stage)||stage<1||stage>16) return null;

 const title=stage===4
  ?'Первое заседание Государственной Думы: подтверждённые итоги'
  :'Итоги этапа '+stage+': '+String(post.context?.stage_title||post.title.replace(/^Завершён этап\s*\d+:\s*/,''));
 const body:string[]=[
  stage===4
   ?'Завершился четвёртый этап политического процесса, посвящённый первому заседанию Государственной Думы Федерального Собрания Российской Федерации. Основные вопросы этапа — избрание руководства палаты и формирование комитетов.'
   :'В политическом процессе зафиксировано завершение этапа '+stage+'. Информация о принятых решениях приводится по подтверждённым записям реестров, а не по формулировкам заданий.'
 ];
 const registered=documents.filter(d=>d.game_id===post.game_id&&d.stage_no===stage&&
  ['adopted','signed','published'].includes(d.status_code));
 if(registered.length){
  body.push('В реестре оформленных документов представлены: '+registered.slice(0,5).map(d=>d.title).join('; ')+
   (registered.length>5?'. Остальные документы доступны в разделе «НПА».':'.'));
 }
 const closed=votes.filter(v=>v.game_id===post.game_id&&v.stage_no===stage&&v.status==='closed');
 if(closed.length){
  body.push('Среди завершённых голосований: '+closed.slice(0,4).map(v=>
   '«'+v.title+'» — '+(v.result_code==='passed'?'решение принято':v.result_code==='rejected'?'решение не принято':v.result_code==='no_quorum'?'кворум не достигнут':'итог определяется по протоколу')).join('; ')+
   (closed.length>4?'. Полный перечень приведён в разделе «Голосования».':'.'));
 }
 if(stage===4){
  body.push('Персональные результаты выборов руководства Государственной Думы и председателей комитетов должны подтверждаться протоколами. Описание задач этапа само по себе не свидетельствует об избрании конкретных должностных лиц.');
 }else if(!registered.length&&!closed.length){
  body.push('Сведения об оформленных решениях пока не представлены в доступной части реестров. Планы этапа не выдаются за состоявшиеся события.');
 }
 return {title,body:body.join('\n\n')};
}
