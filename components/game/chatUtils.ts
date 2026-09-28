import type {Message} from './types';

export type ChatEntry={
 message:Message;
 day:string;
 dayLabel:string;
 startsDay:boolean;
 startsGroup:boolean;
 own:boolean;
};

/** Channels load up to 150 messages. All grouping and searching use only
 * authorised messages returned by the existing game hook, never another feed. */
export function matchChatMessage(message:Message,search:string,author:string,attachmentsOnly=false){
 if(attachmentsOnly&&!['file','audio','video'].includes(message.kind))return false;
 const needle=search.trim().toLocaleLowerCase('ru-RU');
 if(!needle)return true;
 return [message.text||'',author,message.mime_type||''].some(v=>v.toLocaleLowerCase('ru-RU').includes(needle));
}
function keyForDate(date:Date){
 return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function chatDayLabel(iso:string,now:Date=new Date()){
 const date=new Date(iso);
 if(!Number.isFinite(date.getTime()))return 'Без даты';
 const today=keyForDate(now);
 const previous=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1);
 const day=keyForDate(date);
 if(day===today)return 'Сегодня';
 if(day===keyForDate(previous))return 'Вчера';
 return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(date);
}
export function buildChatEntries(items:Message[],myId:string,now:Date=new Date()):ChatEntry[]{
 return items.map((message,i)=>{
  const previous=items[i-1];
  const date=new Date(message.created_at),datePrev=previous?new Date(previous.created_at):null;
  const valid=Number.isFinite(date.getTime()),validPrev=!!datePrev&&Number.isFinite(datePrev.getTime());
  const day=valid?keyForDate(date):'unknown';
  const previousDay=validPrev&&datePrev?keyForDate(datePrev):'unknown';
  const startsDay=!previous||day!==previousDay;
  const minutes=datePrev&&valid&&validPrev?(date.getTime()-datePrev.getTime())/60000:Infinity;
  const startsGroup=startsDay||!previous||previous.author_id!==message.author_id||
   previous.kind==='system'||message.kind==='system'||minutes<0||minutes>6;
  return {
   message,day,dayLabel:valid?chatDayLabel(message.created_at,now):'Без даты',
   startsDay,startsGroup,own:message.author_id===myId
  };
 });
}
export function formatChatTime(iso:string){
 const d=new Date(iso);
 return Number.isFinite(d.getTime())?d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
}
export function isChatAttachment(message:Message){
 return ['file','audio','video'].includes(message.kind);
}
