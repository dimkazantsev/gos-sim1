'use client';
import {useEffect,useState} from 'react';
import {decodePortrait} from './avatarCrop';

export default function ProfileAvatar({src,name,gender='unspecified'}:{src?:string|null;name:string;gender?:'male'|'female'|'unspecified'}){
 const [visible,setVisible]=useState('');
 useEffect(()=>{
  let active=true;
  if(src)void decodePortrait(src).then(()=>{if(active)setVisible(src)}).catch(()=>{});
  else setVisible('');
  return()=>{active=false};
 },[src]);
 if(visible)return <img className="profileAvatarImage" src={visible} alt={'Фото: '+name}/>;
 return <span className={'profileFallbackAvatar '+gender} role="img" aria-label={'Аватар: '+name}>
  <svg viewBox="0 0 100 100" aria-hidden="true">
   <circle cx="50" cy="50" r="50" fill={gender==='female'?'#f6e3ee':gender==='male'?'#dceafa':'#e7edf5'}/>
   {gender==='female'?<>
    <path d="M24 53C17 16 39 10 50 12C77 8 85 35 75 65L24 67Z" fill="#513447"/>
    <path d="M16 103V86C18 67 35 63 50 63S83 67 85 86V103" fill="#a44f81"/>
    <path d="M42 56V67Q50 80 59 67V56" fill="#e7ad89"/>
    <ellipse cx="50" cy="40" rx="18" ry="23" fill="#f4c6a4"/>
    <path d="M29 34Q30 8 54 14Q75 14 73 39Q59 36 54 24Q47 34 29 34" fill="#513447"/>
    <path d="M34 70L43 66L50 78L58 66L68 70L57 88H43Z" fill="#fff2f8"/>
   </>:<>
    <path d="M13 103V89Q17 68 42 65H59Q82 67 87 89V103" fill={gender==='male'?'#315d89':'#657d9b'}/>
    <path d="M41 53V69L50 77L60 68V53" fill="#d9a27d"/>
    <ellipse cx="50" cy="40" rx="19" ry="24" fill="#edbd95"/>
    <path d="M30 36Q25 13 47 13Q75 10 70 38L63 27Q48 30 37 24L36 39Z" fill="#35404d"/>
    <path d="M36 68L42 65L50 78L60 65L66 69L58 83L50 78L42 83Z" fill="#f5fbff"/>
   </>}
   <path d="M41 41H44M57 41H60" stroke="#4b3940" strokeWidth="2.2" strokeLinecap="round"/>
   <path d="M45 52Q50 56 55 52" fill="none" stroke="#9a6757" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
 </span>;
}
