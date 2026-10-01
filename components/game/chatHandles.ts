import type {Member} from './types';
const LETTERS:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
function latin(value:string){return Array.from(value.toLowerCase(),c=>LETTERS[c]??c).join('').replace(/[^a-z0-9_-]/g,'')}
export function chatHandles(members:Member[]){
 const rows=members.filter(m=>m.kind!=='observer').map(member=>{
 const surname=member.full_name.trim().split(/\s+/)[0]||'Участник';
 const base=latin(surname)||'student';
 // The profile uses surname-first names; aliases also cover older free-form names.
 const names=member.full_name.toLowerCase().trim().split(/\s+/);
 return{member,surname,base,aliases:[...new Set([...names,...names.map(latin)].filter(Boolean))]};});
 return rows.map(r=>{const duplicates=rows.filter(x=>x.base===r.base);let length=8;
  const suffix=r.member.user_id.replace(/-/g,'');
  while(length<suffix.length&&duplicates.some(x=>x.member.user_id!==r.member.user_id&&x.member.user_id.replace(/-/g,'').slice(0,length)===suffix.slice(0,length)))length++;
  return {...r,handle:duplicates.length>1?r.base+'_'+suffix.slice(0,length):r.base};
 });
}
