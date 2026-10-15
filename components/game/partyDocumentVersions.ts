import type {PartyDocument} from './types';

export const PARTY_DOC_LABELS:Record<string,string>={
 application:'Заявление',charter:'Устав',program:'Программа',fee:'Пошлина',
 symbol:'Символика',congress_minutes:'Учредительный съезд',other:'Дополнительный документ'
};

export function partyDocumentVersion(document:PartyDocument):number{
 return Math.max(1,Number(document.version_no)||1);
}
export function partyLatestDocuments(documents:PartyDocument[]):PartyDocument[]{
 const byKind=new Map<string,PartyDocument>();
 for(const d of documents){
  const existing=byKind.get(d.doc_kind);
  if(!existing||partyDocumentVersion(d)>partyDocumentVersion(existing)||
   (partyDocumentVersion(d)===partyDocumentVersion(existing)&&
    (d.created_at>existing.created_at||(d.created_at===existing.created_at&&d.id>existing.id))))byKind.set(d.doc_kind,d);
 }
 return [...byKind.values()];
}
export function partyVersionLabel(d:PartyDocument){return 'В'+partyDocumentVersion(d)}
export function partyDocumentStatus(d:PartyDocument){
 return d.status==='accepted'?'Принята':d.status==='revision'?'На доработке':
 d.status==='submitted'?'Ожидает рассмотрения':'Черновик';
}
export function partyLatestAccepted(docs:PartyDocument[],requiredKinds:string[]):boolean{
 const latest=partyLatestDocuments(docs);
 return requiredKinds.every(kind=>latest.some(d=>d.doc_kind===kind&&d.status==='accepted'));
}
