import type {PartyDocument} from './types';

export function partyDocumentVersion(doc:Pick<PartyDocument,'version_number'>):number {
 return Math.max(1,Number(doc.version_number)||1);
}
export function partyDocumentLatest(documents:PartyDocument[]):PartyDocument[] {
 const current=new Map<string,PartyDocument>();
 for(const document of documents){
  const key=document.party_id+'/'+document.doc_kind;
  const previous=current.get(key);
  if(!previous||partyDocumentVersion(document)>partyDocumentVersion(previous)||
    (partyDocumentVersion(document)===partyDocumentVersion(previous)&&
     (document.created_at>previous.created_at||(document.created_at===previous.created_at&&document.id>previous.id)))){
    current.set(key,document);
  }
 }
 return Array.from(current.values()).sort((a,b)=>a.doc_kind.localeCompare(b.doc_kind));
}
export function partyDocumentAttempts(documents:PartyDocument[],kind:PartyDocument['doc_kind']):PartyDocument[]{
 return documents.filter(d=>d.doc_kind===kind)
  .sort((a,b)=>partyDocumentVersion(b)-partyDocumentVersion(a)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
}
export function partyDocumentStatus(document:Pick<PartyDocument,'status'>):string{
 return document.status==='accepted'?'Принято Минюстом':
  document.status==='revision'?'Возвращено на доработку':
  document.status==='submitted'?'Ожидает рассмотрения':'Черновик';
}
export function partyDocumentsReady(documents:PartyDocument[],kinds:readonly PartyDocument['doc_kind'][]):boolean {
 const current=partyDocumentLatest(documents);
 return kinds.every(kind=>current.some(d=>d.doc_kind===kind&&d.status==='accepted'));
}
