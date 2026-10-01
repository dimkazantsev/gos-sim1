import type {Member} from './types';
const LETTERS:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
export function chatHandles(members:Member[]){
 const rows=members.filter(m=>m.kind!=='observer').map(member=>{
 const surname=member.full_name.trim().split(/\s+/)[0]||'Участник';
 const base=Array.from(surname.toLowerCase(),c=>LETTERS[c]??c).join('').replace(/[^a-z0-9_-]/g,'')||'student';
 return{member,surname,base};});
 return rows.map(r=>({...r,handle:rows.filter(x=>x.base===r.base).length>1?r.base+'_'+r.member.user_id.replace(/-/g,'').slice(0,8):r.base}));
}
