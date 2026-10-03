'use client';
import {ArrowUpRight,Landmark,UserRound} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import ProfileAvatar from './ProfileAvatar';
import {REPUBLIC_LEADERSHIP,republicOfficeHolders} from './gameRoster';

export default function RepublicLeadership({g,onOpenProfile}:{g:ReturnTypeRepublic;onOpenProfile?:(id:string)=>void}){
 if(!g.game)return null;
 return <section className="republicLeadership" aria-labelledby="republic-leadership-title">
  <header className="republicLeadershipHeading"><span><Landmark size={18} aria-hidden="true"/></span><h3 id="republic-leadership-title">Руководство республики</h3></header>
  {REPUBLIC_LEADERSHIP.map(office=>{
   const holders=republicOfficeHolders(g.members,g.officeAssignments||[],g.game!.id,office.role);
   return <article key={office.key} className="republicOfficeCard" data-office={office.key}>
    <h4>{office.title}</h4>
    {holders.length?<ul>{holders.map(member=>{
     const profile=g.profiles.find(p=>p.game_id===g.game!.id&&p.user_id===member.user_id);
     const content=<><span className="republicLeaderAvatar"><ProfileAvatar src={profile?.avatar_url} name={member.full_name} gender={profile?.gender}/></span><span className="republicLeaderName">{member.full_name}</span>{onOpenProfile&&<ArrowUpRight size={16} aria-hidden="true"/>}</>;
     return <li key={member.user_id}>{onOpenProfile?<button type="button" onClick={()=>onOpenProfile(member.user_id)} aria-label={'Открыть профиль: '+member.full_name}>{content}</button>:<div className="republicLeaderPerson">{content}</div>}</li>;
    })}</ul>:<div className="republicOfficeVacant"><span className="republicLeaderAvatar">{office.key==='gd_chair'?<Landmark size={20} aria-hidden="true"/>:<UserRound size={20} aria-hidden="true"/>}</span><span>Пока не назначен</span></div>}
   </article>;
  })}
 </section>;
}
