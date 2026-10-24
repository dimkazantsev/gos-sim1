import type {Stage} from './types';
import {STAGE_OPERATIONS} from './stageOperations';
import './stage-meeting-procedure.css';

// A shared presentation contract; voting, documents and permissions keep their
// existing stage-specific server RPCs and approved legal procedures.
const MEETING_STAGES=new Set([2,3,4,5,6,7,8,9,11,12,13,14]);
const STAGE_CONTENT:Record<number,string>={
 2:'Предложения фракций',3:'Метод и договоры',4:'Выборы руководства и комитеты',
 5:'Правила Goust Voting',6:'Выдвижение и регистрация кандидатов',7:'Избирательные процедуры',
 8:'Кандидатуры и состав Правительства',9:'Назначения министров',11:'Государственные программы',
 12:'Законопроекты и чтения',13:'Рассмотрение бюджета',14:'Муниципальные проекты'
};
export default function StageMeetingProcedureFlow({stage,votesCount=0,onOpenVotes,onOpenDocuments}:{
 stage:Stage;votesCount?:number;onOpenVotes:()=>void;onOpenDocuments:()=>void;
}){
 if(!MEETING_STAGES.has(stage.stage_no))return null;
 const phases=[
  ['Повестка','Составление и утверждение уполномоченным лицом'],
  ['Регистрация','Присутствие, полномочия и кворум'],
  ['Рассмотрение',STAGE_CONTENT[stage.stage_no]||STAGE_OPERATIONS[stage.stage_no].title],
  ['Решения и голосования','Единый реестр голосований: '+votesCount],
  ['Итоговые документы','Протокол и предусмотренные игровые документы']
 ];
 return <section className="stageMeetingProcedureFlow" aria-label="Единый порядок заседания">
   <div className="stageMeetingProcedureHead"><strong>Порядок заседания</strong>
    <small>Этап {stage.stage_no} · Порядок действий без изменения полномочий</small></div>
   <ol>{phases.map(([title,description],i)=><li key={title}>
     <span className="stageMeetingProcedureNumber">{String(i+1).padStart(2,'0')}</span>
     <div><b>{title}</b><small>{description}</small></div>
   </li>)}</ol>
   <nav aria-label="Связанные реестры">
    <button type="button" onClick={onOpenVotes}>Все голосования этапа ({votesCount})</button>
    <button type="button" onClick={onOpenDocuments}>Документы и протоколы</button>
   </nav>
  </section>;
}
