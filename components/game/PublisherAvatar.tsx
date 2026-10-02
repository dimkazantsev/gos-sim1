import {Newspaper} from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';
import InstitutionEmblemImage from './InstitutionEmblemImage';
import {gosSimsEmblem,institutionEmblem} from './institutionEmblems';

export default function PublisherAvatar({actorKey,label,partyLogo,avatar,name,gender}:{actorKey:string;label:string;partyLogo?:string|null;avatar?:string|null;name?:string;gender?:'male'|'female'|'unspecified'}){
 if(actorKey==='participant')return <ProfileAvatar src={avatar} name={name||label} gender={gender}/>;
 if(actorKey==='teacher')return <InstitutionEmblemImage src={gosSimsEmblem} alt="GOS//SIMS · флаг Российской Федерации"/>;
 if(actorKey==='media')return <Newspaper size={24} aria-label="Редакция СМИ"/>;
 if(actorKey==='party')return <InstitutionEmblemImage src={partyLogo} alt={'Логотип партии «'+label+'»'} fallback="party"/>;
 return <InstitutionEmblemImage src={institutionEmblem(actorKey,label)} alt={label}/>;
}
