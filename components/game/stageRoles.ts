import type {ReturnTypeRepublic} from './viewTypes';

// UI visibility mirrors both legacy primary roles and active office records.
// Mutations still require the database's independent authorization checks.
export function stageRoleTitles(g:ReturnTypeRepublic):string{
 const titles=[g.me?.role_title||'',...g.officeAssignments.filter(o=>o.user_id===g.me?.user_id&&o.status==='active').map(o=>o.role_title)];
 return titles.join(' | ').toLocaleLowerCase('ru-RU');
}
