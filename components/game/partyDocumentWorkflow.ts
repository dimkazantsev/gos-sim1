import type {PartyDocument} from './types';
export const requiredPartyKinds=['application','charter','program','fee','symbol','congress_minutes'] as const;
export const partyDocumentLabel:Record<string,string>={
 application:'Заявление',charter:'Устав',program:'Программа',fee:'Пошлина',
 symbol:'Символика',congress_minutes:'Учредительный съезд',other:'Дополнительный документ'
};
export function partyDocVersion(d:PartyDocument){return Math.max(1,d.version_no||1)}
export function partyDocumentLatest(documents:PartyDocument[]){
 const current=new Map<string,PartyDocument>();
 for(const d of documents){
  const previous=current.get(d.doc_kind);
  if(!previous||partyDocVersion(d)>partyDocVersion(previous)||
   partyDocVersion(d)===partyDocVersion(previous)&&(d.created_at>previous.created_at||
    d.created_at===previous.created_at&&d.id>previous.id)){
   current.set(d.doc_kind,d);
  }
 }
 return current;
}
export function partyRegistrationReady(documents:PartyDocument[]){
 const latest=partyDocumentLatest(documents);
 return requiredPartyKinds.every(kind=>latest.get(kind)?.status==='accepted');
}
export function partyLatestPublicDocuments(documents:PartyDocument[],registeredAndCertified:boolean){
 if(!registeredAndCertified)return [];
 return [...partyDocumentLatest(documents).values()].filter(d=>
  ['charter','program','symbol','congress_minutes'].includes(d.doc_kind)&&d.status==='accepted');
}
