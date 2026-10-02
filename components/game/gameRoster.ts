import type {GameOfficeAssignment,GameProfile,Member} from './types';

/** Public roster for one classroom; archived sign-ins keep their audit trail. */
export function currentGameMembers(rows:Member[],gameId:string):Member[]{
 const seen=new Set<string>();
 return rows.filter(row=>{
  if(row.game_id!==gameId||row.roster_archived_at||seen.has(row.user_id))return false;
  seen.add(row.user_id);return true;
 });
}

export function currentGameProfiles(rows:GameProfile[],members:Member[],gameId:string){
 const ids=new Set(currentGameMembers(members,gameId).map(m=>m.user_id));
 return rows.filter(row=>row.game_id===gameId&&ids.has(row.user_id));
}

export const REPUBLIC_LEADERSHIP=[
 {key:'president',title:'Президент',role:/^президент(?:\s|$)/i},
 {key:'gd_chair',title:'Председатель ГД',role:/^председатель\s+(?:государственной\s+думы|гд)(?:\s|$)/i},
 {key:'prime_minister',title:'Председатель Правительства',role:/^председатель\s+правительства(?:\s|$)/i}
] as const;

export function republicOfficeHolders(members:Member[],offices:GameOfficeAssignment[],gameId:string,role:RegExp){
 return currentGameMembers(members,gameId).filter(member=>{
  if(member.kind==='observer')return false;
  const assignments=offices.filter(o=>o.game_id===gameId&&o.user_id===member.user_id&&role.test(o.role_title.trim()));
  if(assignments.length)return assignments.some(o=>o.status==='active');
  // Older appointments and the teacher's voluntary role use the current title.
  return (member.role_title||'').split(' · ').some(title=>role.test(title.trim()));
 });
}
