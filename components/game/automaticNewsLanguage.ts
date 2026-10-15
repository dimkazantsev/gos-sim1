/** User-facing presentation of historical and future automatically generated news.
 * Stored source keys, post bodies, statuses and searchable tags remain unchanged.
 */
const STATE_LABELS:Record<string,string>={
 signed:'подписано',approved:'одобрено',rejected:'отклонено',
 published:'опубликовано',adopted:'принято',registered:'зарегистрировано',
 submitted:'направлено на рассмотрение',pending:'на рассмотрении',
 revision:'возвращено на доработку',draft:'проект',open:'открыто',
 closed:'закрыто',completed:'завершено',accepted:'принято',
 cancelled:'отменено',archived:'перенесено в архив'
};
const DOCUMENT_STATE_LABELS:Record<string,string>={
 signed:'подписан',approved:'одобрен',rejected:'отклонён',
 published:'опубликован',adopted:'принят',registered:'зарегистрирован',
 submitted:'направлен на рассмотрение',pending:'на рассмотрении',
 revision:'возвращён на доработку',draft:'подготовлен как проект',
 open:'открыт',closed:'закрыт',completed:'завершён',
 accepted:'принят',cancelled:'отменён',archived:'перенесён в архив'
};

export function localizeAutomaticNewsText(value:string):string{
 return value
  .replace(/Основание:\s*НПА:\s*([^\n]+?)\s*(?:→|->)\s*([a-z][a-z0-9_]*)\b/gi,(match,title:string,raw:string)=>{
   const label=DOCUMENT_STATE_LABELS[raw.toLowerCase()];
   return label?`Основание: документ «${title.trim()}» ${label}`:match;
  })
  .replace(/(\bСтатус(?:\s+документа|\s+НПА)?\s*[:=]\s*)([a-z][a-z0-9_]*)\b/gi,(match,prefix:string,raw:string)=>{
   const label=STATE_LABELS[raw.toLowerCase()];
   return label?prefix+label:match;
  })
  .replace(/(→|->)\s*([a-z][a-z0-9_]*)\b/gi,(match,arrow:string,raw:string)=>{
   const label=STATE_LABELS[raw.toLowerCase()];
   return label?arrow+' '+label:match;
  });
}

/** The suffix is a technical scope identifier; keep it in stored tag/search. */
export function localizeAutomaticNewsTag(tag:string):string{
 const match=/^(этап|ходигры|сми)_gpyasu$/i.exec(tag);
 return match?({этап:'этап',ходигры:'ход_игры',сми:'СМИ'}[match[1].toLowerCase()]||tag):tag;
}
