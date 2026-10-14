/** Telegram output convention: one bold heading (the transport formats line 1),
 * a blank line, then unbolded paragraphs. Do not edit user-authored content. */
export const NOTICE_TOPICS:Record<string,string>={
 chat:'Чаты',mention_chat:'Упоминания',mention_actions:'Политический процесс',
 mention_documents:'Документы',document:'Документы',document_delivery:'Документы',
 task:'Поручения',task_done:'Поручения',stage:'Этапы',
 event:'События',vote:'Голосования',daily_brief:'Утренний доклад',
 appeal:'Приёмная',appeal_reply:'Приёмная',
 party_invite:'Партии',party_registration:'Минюст',party_document:'Минюст',party_review:'Партии'
};
export function telegramSystemNotice(category:string,body:string){
 const normalized=body.trim().replace(/\r\n?/g,'\n').replace(/\n{3,}/g,'\n\n');
 if(/^.{0,12}ГОС\.ID\s*[·—-]/u.test(normalized.split('\n')[0]||''))return normalized;
 return '🏛 ГОС.ID · '+(NOTICE_TOPICS[category]||'Уведомление')+'\n\n'+normalized;
}
export function telegramGroupNotices(category:string,bodies:string[]){
 if(!bodies.length)throw new Error('Cannot group empty notification batch');
 return '🏛 ГОС.ID · '+(NOTICE_TOPICS[category]||'Уведомления')+
  '\n\n'+bodies.slice(0,4).map((body,i)=>(i+1)+'. '+body.trim().slice(0,650)).join('\n\n');
}
