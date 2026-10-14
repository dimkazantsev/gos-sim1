import {FORMAL_SUBJECTS} from './formalInstitutions';
import type {ReturnTypeRepublic} from './viewTypes';

// This is a UI filter only. The database independently authorizes the subject
// and verifies any recorded office id at document creation.
export function officeSupportsSubject(role:string,subject:string):boolean{
 const r=role.toLocaleLowerCase('ru-RU');
 switch(subject){
  case 'ksrf':return false; // attendance is not an appointment to sign for a party
  case 'president':return r.includes('президент');
  case 'gd_deputy':return r.includes('депутат');
  case 'gd':return (r.includes('председател')||r.includes('совет'))&&r.includes('дум');
  case 'sf_member':return r.includes('сенатор');
  case 'sf':return (r.includes('председател')&&r.includes('совет')&&r.includes('федерац'))||r.includes('совет федерац');
  case 'government':return r.includes('правительств')||r.includes('министр');
  case 'ministry':return r.includes('министр')||r.includes('министерств');
  case 'municipality':return r.includes('муницип')||r.includes('глава города')||r.includes('администрац');
  case 'region':return r.includes('регион')||r.includes('субъект')||r.includes('законодательн');
  case 'ks':return r.includes('конституционн')&&r.includes('суд');
  case 'vs':return r.includes('верховн')&&r.includes('суд');
  default:return false;
 }
}
export type ActingOffice={value:string;id:string|null;role:string;userId:string|null;label:string};
export function actingOfficeOptions(g:ReturnTypeRepublic,subject:string):ActingOffice[]{
 const me=g.me;
 if(!me)return [];
 const options:ActingOffice[]=[];
 // The teacher can act in an administrative capacity, but cannot silently
 // impersonate another participant without identifying the chosen appointment.
 if(g.teacher){
  options.push({value:'admin',id:null,userId:null,role:FORMAL_SUBJECTS.find(s=>s.key===subject)?.label||'Администратор',label:'Административное оформление (преподаватель)'});
 }
 for(const o of g.officeAssignments){
  if(o.status!=='active'||(!g.teacher&&o.user_id!==me.user_id)||!officeSupportsSubject(o.role_title,subject))continue;
  const name=g.members.find(m=>m.user_id===o.user_id)?.full_name||'Участник';
  options.push({value:o.id,id:o.id,userId:o.user_id,role:o.role_title,label:g.teacher?o.role_title+' — '+name:o.role_title});
 }
 if(!g.teacher&&!options.length&&officeSupportsSubject(me.role_title||'',subject)){
  options.push({value:'legacy',id:null,userId:me.user_id,role:me.role_title||'',label:me.role_title||''});
 }
 if(subject==='ksrf'&&!options.length&&!g.teacher&&me.kind==='student')
  options.push({value:'ksrf',id:null,userId:me.user_id,role:'Представитель КСРФ',label:'Участник КСРФ'});
 return options;
}
