'use client';
import ProfileAvatar from './ProfileAvatar';
import type {Member,GameProfile} from './types';
type Decision={actor_id:string;choice:string};
function index(choice:string){return choice==='accept'?0:choice==='reject'?1:Number(choice.replace('option_',''))-1}
export default function EventChoicePanel({labels,decisions,members,profiles,currentChoice,canAnswer,onAnswer,notice,revealResults=false,shuffleSeed=''}:{labels:string[];decisions:Decision[];members:Member[];profiles:GameProfile[];currentChoice?:string;canAnswer:boolean;onAnswer:(choice:string)=>void;notice?:string;revealResults?:boolean;shuffleSeed?:string}){
 const hash=(value:string)=>{let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
 let seed=hash(shuffleSeed||'event');
 const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296};
 const order=labels.map((_,i)=>i);
 for(let i=order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 return <div className="eventAnswerPanel" role="group" aria-label="Варианты решения">{order.map(i=>{const label=labels[i];
  const voters=decisions.filter(d=>index(d.choice)===i),percent=decisions.length?Math.round(voters.length*100/decisions.length):0;
  return <button type="button" className="eventAnswerChoice" key={i} disabled={!canAnswer} aria-pressed={currentChoice?index(currentChoice)===i:false} onClick={()=>onAnswer('option_'+(i+1))}>
   <span className="eventAnswerHeading"><b>{label}</b>{revealResults&&<strong>{percent}%</strong>}</span>
   {revealResults&&<span className="eventAnswerProgress" aria-hidden="true"><i style={{width:percent+'%'}}/></span>}
   {revealResults&&<span className="eventAnswerPeople"><span className="eventAnswerAvatars">{voters.slice(0,8).map(d=>{const member=members.find(m=>m.user_id===d.actor_id),profile=profiles.find(p=>p.user_id===d.actor_id);return <span className="eventVoter" key={d.actor_id} title={member?.full_name||'Участник'}><ProfileAvatar src={profile?.avatar_url} name={member?.full_name||'Участник'} gender={profile?.gender}/></span>})}{voters.length>8&&<span className="eventVoterMore">+{voters.length-8}</span>}</span><span>Голосов: {voters.length}</span></span>}
  </button>;
 })}{notice&&<p className="eventAnswerNotice" role="status">{notice}</p>}</div>;
}
