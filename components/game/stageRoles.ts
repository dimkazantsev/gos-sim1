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

// Display priority follows the procedures of the 16 stages. It changes labels
// only and never creates an appointment or grants an action permission.
const stageOfficePriorities:Partial<Record<number,readonly RegExp[]>>={
 2:[/^член\s+ксрф(?=\s|$)/iu,/^председатель\s+ксрф(?=\s|$)/iu],
 3:[/^член\s+ксрф(?=\s|$)/iu,/^председатель\s+ксрф(?=\s|$)/iu],
 4:[/^председатель\s+(?:государственной\s+думы|гд)(?=\s|$)/iu,/^заместитель\s+председателя\s+(?:государственной\s+думы|гд)(?=\s|$)/iu,/^председатель\s+комитета(?=\s|$)/iu,/^депутат\s+государственной\s+думы(?=\s|$)/iu],
 5:[/^председатель\s+(?:государственной\s+думы|гд)(?=\s|$)/iu,/^заместитель\s+председателя\s+(?:государственной\s+думы|гд)(?=\s|$)/iu,/^депутат\s+государственной\s+думы(?=\s|$)/iu],
 6:[/(?:^|\s)цик(?=\s|$)/iu,/(?:^|\s)избирательной\s+комиссии(?=\s|$)/iu,/(?:^|\s)совета\s+федерации(?=\s|$)/iu],
 7:[/(?:^|\s)цик(?=\s|$)/iu,/(?:^|\s)избирательной\s+комиссии(?=\s|$)/iu,/^президент\s+российской\s+федерации$/iu],
 8:[/^председатель\s+правительства(?=\s|$)/iu,/^президент\s+российской\s+федерации$/iu,/^депутат\s+государственной\s+думы(?=\s|$)/iu],
 9:[/^председатель\s+правительства(?=\s|$)/iu,/^заместитель\s+председателя\s+правительства(?=\s|$)/iu,/^министр(?=\s|$)/iu,/^президент\s+российской\s+федерации$/iu],
 10:[/^председатель\s+правительства(?=\s|$)/iu,/^заместитель\s+председателя\s+правительства(?=\s|$)/iu,/^министр(?=\s|$)/iu,/^президент\s+российской\s+федерации$/iu],
 11:[/^председатель\s+правительства(?=\s|$)/iu,/^заместитель\s+председателя\s+правительства(?=\s|$)/iu,/^министр(?=\s|$)/iu],
 12:[/^председатель\s+(?:государственной\s+думы|гд)(?=\s|$)/iu,/^заместитель\s+председателя\s+(?:государственной\s+думы|гд)(?=\s|$)/iu,/^председатель\s+комитета(?=\s|$)/iu,/^депутат\s+государственной\s+думы(?=\s|$)/iu,/(?:^|\s)совета\s+федерации(?=\s|$)/iu],
 13:[/^председатель\s+правительства(?=\s|$)/iu,/^заместитель\s+председателя\s+правительства(?=\s|$)/iu,/^министр(?=\s|$)/iu,/(?:^|\s)банка\s+россии(?=\s|$)/iu,/^депутат\s+государственной\s+думы(?=\s|$)/iu],
 14:[/^глава\s+(?:города|муниципального)/iu,/^руководитель\s+(?:районной|муниципальной)/iu]
};
export function relevantStageRoleTitle(titles:readonly string[],stageNo:number):string{
 for(const pattern of stageOfficePriorities[stageNo]||[]){
  const title=titles.find(value=>pattern.test(value.trim()));
  if(title)return title;
 }
 return titles[0]||'';
}
// The teacher's "current stage" heading selects the earliest open stage.
export function currentGameStageNumber(g:ReturnTypeRepublic):number{
 const ongoing=g.stages.filter(s=>s.status==='open').sort((a,b)=>
  (a.deadline?Date.parse(a.deadline):Infinity)-(b.deadline?Date.parse(b.deadline):Infinity)||a.stage_no-b.stage_no);
 return ongoing[0]?.stage_no||g.currentStage?.stage_no||g.game?.current_round||1;
}
export function currentStageRoleTitle(g:ReturnTypeRepublic,userId:string,stageNo=currentGameStageNumber(g)):string{
 return relevantStageRoleTitle(activeGameRoleTitles(g,userId),stageNo);
}
