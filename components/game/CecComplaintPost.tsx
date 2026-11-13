import {ChevronDown} from 'lucide-react';
import type {PoliticalPost,View} from './types';
import RichPostText from './RichPostText';

/* One approved CEC reply in the standard Political Process card.
   The private complainant, allegation and membership are never loaded here. */
export default function CecComplaintPost({
 post,onNavigate,onOpenDocument,onOpenVotes
}:{
 post:PoliticalPost;
 onNavigate:(view:View,target?:{stageNo?:number})=>void;
 onOpenDocument:(id:string)=>void;
 onOpenVotes:(id?:string)=>void;
}){
 const context=post.context||{};
 const subject=typeof context.cec_complaint_subject==='string'
  ?context.cec_complaint_subject.trim():'';
 const status=typeof context.cec_complaint_status==='string'
  ?context.cec_complaint_status:'';
 const outcome:Record<string,string>={
  maintained:'Регистрация кандидата сохранена.',
  dismissed:'В удовлетворении жалобы отказано.',
  removed:'Кандидат снят с выборов.',
  referred_court:'Материалы направлены на рассмотрение Верховного Суда Российской Федерации.'
 };
 return <div className="cecComplaintPost">
  <section className="cecComplaintSubject" aria-label="Суть жалобы">
   <h3>Суть жалобы</h3>
   <p>{subject||'Рассмотрено обращение в отношении кандидата на должность Президента Российской Федерации.'}</p>
  </section>
  <section className="cecComplaintDecision" aria-label="Ответ Центральной избирательной комиссии">
   <h3>Ответ Центральной избирательной комиссии</h3>
   <strong>{outcome[status]||'Решение по жалобе принято.'}</strong>
   <details>
    <summary>Показать полный ответ ЦИК <ChevronDown size={16} aria-hidden="true"/></summary>
    <div className="cecComplaintFullResponse">
     <RichPostText text={post.body} onNavigate={onNavigate} onOpenDocument={onOpenDocument} onOpenVotes={onOpenVotes}/>
    </div>
   </details>
  </section>
 </div>;
}
