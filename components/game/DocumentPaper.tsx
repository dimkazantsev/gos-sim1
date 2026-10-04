import type {ReactNode} from 'react';
import type {FormalDocument,FormalHistory,Member} from './types';
import {FORMAL_TYPES} from './formalInstitutions';
import {institutionEmblem} from './institutionEmblems';
import InstitutionEmblemImage from './InstitutionEmblemImage';
export default function DocumentPaper({document:d,history,members,signature,titleSlot,footerSlot,children}:{document:FormalDocument;history:FormalHistory[];members:Member[];signature?:{signer_id:string;signed_at:string;url:string|null};titleSlot?:ReactNode;footerSlot?:ReactNode;children:ReactNode}){
 const m=d.metadata||{},revisionTime=Date.parse(String(m.revision_changed_at||'')),signed=history.find(h=>(h.to_status==='signed'||h.action.startsWith('Подпис'))&&!h.action.startsWith('Сохранена редакция')&&(!Number.isFinite(revisionTime)||Date.parse(h.created_at)>=revisionTime)),validSignature=signature&&(!Number.isFinite(revisionTime)||Date.parse(signature.signed_at)>=revisionTime)?signature:undefined,metadataSigned=!!m.signed_on&&(!Number.isFinite(revisionTime)||Date.parse(String(m.signed_on))>=revisionTime),name=String(metadataSigned?m.signed_name||'':members.find(p=>p.user_id===(validSignature?.signer_id||signed?.actor_id))?.full_name||''),role=String(metadataSigned?m.signed_role||'':''),date=String(metadataSigned?m.signed_on:validSignature?.signed_at||signed?.created_at||'');
 const bill=['fz_bill','fkz_bill','federal_budget'].includes(d.doc_type),issuer=bill?'Российская Федерация':String(m.issuer_name||m.issuer||m.institution||d.subject_label),emblem=String(m.template_key||'').startsWith('party_')?null:institutionEmblem(bill?'president':d.subject_key,issuer);
 const type=bill?(d.doc_type==='fkz_bill'?'Федеральный конституционный закон':'Федеральный закон'):(d.doc_type==='party_certificate'?'Свидетельство о регистрации':d.doc_type==='justice_response'?'Официальный ответ':FORMAL_TYPES.find(t=>t.key===d.doc_type)?.label||'Документ');
 const registered=String(m.registered_on||d.created_at),number=String(m.act_number||d.registry_no),place=String(m.place||'Москва');
 return <article className="formalPaper legalDocumentPaper">
  <header className="legalMasthead">{emblem&&<InstitutionEmblemImage className="legalEmblem" src={emblem} alt={'Эмблема: '+issuer} width={80} height={80}/>}<div className="formalPaperInstitution">{issuer}</div>{!name&&<span className="legalDraftBadge">Проект</span>}<div className="formalPaperType">{type}</div></header>
  <div className="formalPaperMeta"><time>{new Date(registered).toLocaleDateString('ru-RU',{timeZone:'Asia/Novosibirsk'})}</time><span>№ {number}</span><span>{place}</span></div><h1>{titleSlot||d.title}</h1>
  {children}
  <div className="formalSignature"><div>{name?<><span>{role||'Уполномоченное лицо'}</span><b>{name}</b>{date&&<small>Подписано {new Date(date).toLocaleDateString('ru-RU',{timeZone:'Asia/Novosibirsk'})}</small>}</>:<span>{Number.isFinite(revisionTime)?'Новая редакция ожидает подписания':'Ожидает подписания уполномоченным лицом'}</span>}</div>{validSignature?.url&&<figure className="formalSignatureImage"><img src={validSignature.url} alt={'Подпись: '+name}/></figure>}</div>
  <footer className="legalPaperFooterBar"><span>Учебный документ деловой игры GOS//SIMS</span>{footerSlot}</footer>
 </article>;
}
