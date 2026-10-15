import type {PartyDocument} from './types';

/** Historic versions remain visible to the owning party; only the latest can be reviewed. */
export function latestPartyDocuments(docs:PartyDocument[]):PartyDocument[]{
 const current=new Map<PartyDocument['doc_kind'],PartyDocument>();
 for(const d of docs){
  const old=current.get(d.doc_kind);
  if(!old||(d.version_no??1)>(old.version_no??1)||
   ((d.version_no??1)===(old.version_no??1)&&
    (d.created_at>old.created_at||(d.created_at===old.created_at&&d.id>old.id))))
   current.set(d.doc_kind,d);
 }
 return [...current.values()];
}
export function latestPartyDocument(docs:PartyDocument[],kind:PartyDocument['doc_kind']){
 return latestPartyDocuments(docs).find(d=>d.doc_kind===kind);
}
export function partyDocumentVersionLabel(d:PartyDocument){return 'В'+(d.version_no??1)}
export function partyDocumentVerdict(d:PartyDocument){
 return d.status==='accepted'?'Принято':d.status==='revision'?'На доработке':d.status==='submitted'?'На рассмотрении':'Черновик';
}
