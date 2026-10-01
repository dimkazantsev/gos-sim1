import {Building2,Landmark,Newspaper} from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';
import {institutionEmblem} from './institutionEmblems';
export default function PublisherAvatar({actorKey,label,partyLogo,avatar,name,gender}:{actorKey:string;label:string;partyLogo?:string|null;avatar?:string|null;name?:string;gender?:'male'|'female'|'unspecified'}){
 if(actorKey==='participant')return <ProfileAvatar src={avatar} name={name||label} gender={gender}/>;
 if(actorKey==='teacher')return <img src="/icon.svg" alt="GOS//SIMS"/>;
 if(actorKey==='media')return <Newspaper size={24} aria-label="Редакция СМИ"/>;
 if(actorKey==='party')return partyLogo?<img src={partyLogo} alt={'Логотип партии «'+label+'»'}/>:<Landmark size={24} aria-label="Политическая партия"/>;
 const emblem=institutionEmblem(actorKey,label);
 return emblem?<img src={emblem} alt={label}/>:<Building2 size={24} aria-label={label}/>;
}
