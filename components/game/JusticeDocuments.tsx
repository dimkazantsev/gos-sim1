'use client';
import {useRef,useState} from 'react';
import {Download,FileText,X} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
import DocumentPaper from './DocumentPaper';
import type {ReturnTypeRepublic} from './viewTypes';
export default function JusticeDocuments({g,partyId}:{g:ReturnTypeRepublic;partyId:string}){
 const docs=g.formalDocuments.filter(d=>d.metadata?.party_id===partyId&&['justice_response','party_certificate'].includes(d.doc_type));
 const [id,setId]=useState('');const paper=useRef<HTMLDivElement>(null);const dialog=useDialog(!!id,()=>setId(''));
 const selected=docs.find(d=>d.id===id);
 function download(){if(!paper.current||!selected)return;const html='<!doctype html><html lang="ru"><meta charset="utf-8"><title>'+selected.registry_no+'</title><style>body{font:16px Georgia;margin:40px auto;max-width:780px;color:#172b44}header{text-align:center}img{max-width:100px;max-height:100px;object-fit:contain}h1{font-size:24px;text-align:center}.formalPaperMeta,.formalSignature{display:flex;justify-content:space-between;gap:20px;margin:30px 0}.formalPaperInstitution{font-weight:bold;margin:16px}.justiceBody{white-space:pre-wrap;line-height:1.7}footer{margin-top:50px;color:#63758e;font-size:12px}.legalDraftBadge{display:none}</style>'+paper.current.innerHTML.replaceAll('src="/','src="'+window.location.origin+'/')+'</html>';const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=selected.registry_no+'.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 if(!docs.length)return null;
 return <section className="justiceDocuments"><h4><FileText size={18}/> Документы Минюста</h4>{docs.map(d=><button type="button" key={d.id} onClick={()=>setId(d.id)}><FileText size={18}/><span><b>{d.title}</b><small>№ {String(d.metadata.act_number||d.registry_no)} · {new Date(d.created_at).toLocaleDateString('ru-RU')}</small></span></button>)}{selected&&<div className="eventCaseBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setId('')}}><section className="eventCaseModal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={selected.title}><header className="eventModalHeader"><button className="secondary" onClick={download}><Download size={18}/> Скачать документ</button><button className="eventModalClose" aria-label="Закрыть документ" onClick={()=>setId('')}><X size={20}/></button></header><div className="eventModalBody" ref={paper}><DocumentPaper document={selected} history={g.formalHistory.filter(h=>h.document_id===selected.id)} members={g.members}><div className="justiceBody">{selected.body_text}</div></DocumentPaper></div></section></div>}</section>;
}
