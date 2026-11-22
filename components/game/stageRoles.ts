import type {ReturnTypeRepublic} from './viewTypes';

// A member keeps the original role and all active game-scoped office appointments.
// UI labels never grant authority: writes always run under the database's own checks.
export function activeGameRoleTitles(g:ReturnTypeRepublic,userId:string|undefined=g.me?.user_id):string[]{
 if(!userId||!g.game)return [];
 const member=g.members.find(m=>m.game_id===g.game?.id&&m.user_id===userId)
  ||(g.me?.user_id===userId&&g.me.game_id===g.game.id?g.me:null);
 if(!member||member.kind==='observer'||member.roster_archived_at)return [];
 const titles=[member.role_title||'',...g.officeAssignments.filter(o=>
  o.game_id===g.game?.id&&o.user_id===userId&&o.status==='active').map(o=>o.role_title)];
 const seen=new Set<string>();
 return titles.map(title=>title.trim()).filter(title=>{
  const key=title.toLocaleLowerCase('ru-RU').replace(/\s+/g,' ');
  if(!key||seen.has(key))return false;
  seen.add(key);return true;
 });
}
export function hasActiveGameRole(g:ReturnTypeRepublic,pattern:RegExp,userId:string|undefined=g.me?.user_id):boolean{
 return activeGameRoleTitles(g,userId).some(title=>pattern.test(title.toLocaleLowerCase('ru-RU')));
}
export function stageRoleTitles(g:ReturnTypeRepublic):string{
 return activeGameRoleTitles(g).join(' | ').toLocaleLowerCase('ru-RU');
}
