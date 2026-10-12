export const PROFILE_SETUP_FIELDS=['name','gender','bio','signature','email','password'] as const;
export type ProfileSetupField=typeof PROFILE_SETUP_FIELDS[number];
export type ProfileSetupStatus={completed:boolean;prompt_seen:boolean;missing:ProfileSetupField[]};
export const PROFILE_SETUP_LABELS:Record<ProfileSetupField,string>={
 name:'Фамилия, имя и отчество',
 gender:'Пол',
 bio:'Описание профиля (не менее 15 символов)',
 signature:'Игровая подпись',
 email:'Подтверждённая электронная почта',
 password:'Личный пароль'
};
export function validProfileSetupStatus(value:unknown):value is ProfileSetupStatus{
 if(!value||typeof value!=='object')return false;
 const v=value as Partial<ProfileSetupStatus>;
 return typeof v.completed==='boolean'&&typeof v.prompt_seen==='boolean'&&
  Array.isArray(v.missing)&&v.missing.every(x=>PROFILE_SETUP_FIELDS.includes(x));
}
