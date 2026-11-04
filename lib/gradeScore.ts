/** Number formatting is shared so every score stays within two decimal places. */
const gradeFormatter=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
export function formatGradeScore(value:number|null|undefined):string{
 return value===null||value===undefined||!Number.isFinite(value)?'—':gradeFormatter.format(value);
}
/** Decimal comma/dot supported, without silently truncating teacher input. */
export function parseTeacherGradeInput(value:string):number|null{
 const normalized=value.trim();
 if(!/^(?:[0-2](?:[.,]\d{1,2})?|3(?:[.,]0{1,2})?)$/.test(normalized))return null;
 const score=Number(normalized.replace(',','.'));
 return Number.isFinite(score)&&score>=0&&score<=3?score:null;
}
