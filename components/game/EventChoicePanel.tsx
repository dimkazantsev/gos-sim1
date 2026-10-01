'use client';
import ProfileAvatar from './ProfileAvatar';
import type {Member,GameProfile} from './types';
type Decision={actor_id:string;choice:string};
function index(choice:string){return choice==='accept'?0:choice==='reject'?1:Number(choice.replace('option_',''))-1}
export default function EventChoicePanel({labels,decisions,members,profiles,currentChoice,canAnswer,onAnswer,notice}:{labels:string[];decisions:Decision[];members:Member[];profiles:GameProfile[];currentChoice?:string;canAnswer:boolean;onAnswer:(choice:string)=>void;notice?:string}){
 return <div className="eventAnswerPanel" role="group" aria-label="Варианты решения">{labels.map((label,i)=>{
  const voters=decisions.filter(d=>index(d.choice)===i),percent=decisions.length?Math.round(voters.length*100/decisions.length):0;
  return <button type="button" className="eventAnswerChoice" key={i} disabled={!canAnswer} aria-pressed={currentChoice?index(currentChoice)===i:false} onClick={()=>onAnswer('option_'+(i+1))}>
   <span className="eventAnswerHeading"><b>{label}</b><strong>{percent}%</strong></span>
   <span className="eventAnswerProgress" aria-hidden="true"><i style={{width:percent+'%'}}/></span>
   <span className="eventAnswerPeople"><span className="eventAnswerAvatars">{voters.slice(0,8).map(d=>{const member=members.find(m=>m.user_id===d.actor_id),profile=profiles.find(p=>p.user_id===d.actor_id);return <span className="eventVoter" key={d.actor_id} title={member?.full_name||'Участник'}><ProfileAvatar src={profile?.avatar_url} name={member?.full_name||'Участник'} gender={profile?.gender}/></span>})}{voters.length>8&&<span className="eventVoterMore">+{voters.length-8}</span>}</span><span>Голосов: {voters.length}</span></span>
  </button>;
 })}{notice&&<p className="eventAnswerNotice" role="status">{notice}</p>}</div>;
}
