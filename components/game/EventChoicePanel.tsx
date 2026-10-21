'use client';
import ProfileAvatar from './ProfileAvatar';
import type {Member,GameProfile} from './types';
type Decision={actor_id:string;choice:string};
function index(choice:string){return choice==='accept'?0:choice==='reject'?1:Number(choice.replace('option_',''))-1}
function publishedExplanation(value?:string){
 return value?.replaceAll('При отсутствии нужной игровой должности необходимо было пригласить уполномоченного участника до голосования.','Если решение выходит за пределы полномочий адресата, следует привлечь компетентное должностное лицо.')
  .replaceAll('В учебной модели устранён конкретный правовой риск.','Устранён выявленный правовой риск.').trim()||'';
}
function publishedLegalBasis(value?:string){
 if(!value||/учебн|вымышлен|авторская|игровой|модель/iu.test(value))return '';
 return /Конституци|Федеральн|\bФКЗ\b|\d+-ФЗ|\bКоАП\b|\b[БУГНТ]К\s*РФ\b|\bстать[яи]\b|Постановлени|Указ Президента/iu.test(value)?value.trim():'';
}
export default function EventChoicePanel({labels,decisions,members,profiles,currentChoice,canAnswer,onAnswer,notice,revealResults=false,shuffleSeed='',showCorrectExplanation=false,correctIndex=null,bestDescription,bestLegalBasis}:{labels:string[];decisions:Decision[];members:Member[];profiles:GameProfile[];currentChoice?:string;canAnswer:boolean;onAnswer:(choice:string)=>void;notice?:string;revealResults?:boolean;shuffleSeed?:string;showCorrectExplanation?:boolean;correctIndex?:number|null;bestDescription?:string;bestLegalBasis?:string}){
 const cleanDescription=publishedExplanation(bestDescription),cleanBasis=publishedLegalBasis(bestLegalBasis);
 const hash=(value:string)=>{let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
 let seed=hash(shuffleSeed||'event');
 const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296};
 const order=labels.map((_,i)=>i);
 for(let i=order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 return <div className="eventAnswerPanel" role="group" aria-label="Варианты решения">{order.map(i=>{const label=labels[i];
  const voters=decisions.filter(d=>index(d.choice)===i),percent=decisions.length?Math.round(voters.length*100/decisions.length):0;
  const selected=!!currentChoice&&index(currentChoice)===i;
  const verdict=revealResults&&typeof correctIndex==='number'&&Number.isInteger(correctIndex)&&correctIndex>=0&&correctIndex<labels.length?(i===correctIndex?'correct':selected?'incorrect':''):'';
  return <div className={'eventAnswerOption '+(verdict?'is-'+verdict:'')} data-best-option={verdict==='correct'?'true':undefined} key={i}>
   <button type="button" className={'eventAnswerChoice '+verdict} disabled={!canAnswer} aria-pressed={selected} onClick={()=>onAnswer('option_'+(i+1))}>
    <span className="eventAnswerHeading"><b>{label}</b>{revealResults&&<strong>{percent}%</strong>}</span>
    {verdict==='correct'&&<span className="eventAnswerBestLabel">Наиболее обоснованный вариант <span aria-hidden="true">✓</span></span>}
    {revealResults&&<span className="eventAnswerProgress" aria-hidden="true"><i style={{width:percent+'%'}}/></span>}
    {revealResults&&<span className="eventAnswerPeople"><span className="eventAnswerAvatars">{voters.slice(0,8).map(d=>{const member=members.find(m=>m.user_id===d.actor_id),profile=profiles.find(p=>p.user_id===d.actor_id);return <span className="eventVoter" key={d.actor_id} title={member?.full_name||'Участник'}><ProfileAvatar src={profile?.avatar_url} name={member?.full_name||'Участник'} gender={profile?.gender}/></span>})}{voters.length>8&&<span className="eventVoterMore">+{voters.length-8}</span>}</span><span>Голосов: {voters.length}</span></span>}
   </button>
   {showCorrectExplanation&&i===correctIndex&&(cleanDescription||cleanBasis)&&<div className="eventAnswerInlineFeedback" aria-label="Объяснение правильного варианта">{cleanDescription&&<p>{cleanDescription}</p>}{cleanBasis&&(!cleanDescription||!cleanDescription.includes(cleanBasis))&&<p className="eventLegalBasis"><b>Правовое основание:</b> {cleanBasis}</p>}</div>}
  </div>;
 })}{notice&&<p className="eventAnswerNotice" role="status">{notice}</p>}</div>;
}