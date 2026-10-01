'use client';
import {useEffect,useState} from 'react';
import {Check,Newspaper,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import DisclosureSummary from '../ui/DisclosureSummary';
import RichPostText from './RichPostText';
import type {ReturnTypeRepublic} from './viewTypes';
import type {View} from './types';
type Proposal={id:string;author_id:string;title:string;body:string;tags:string[];submitted_actor:string;status:'pending'|'approved'|'rejected';review_note:string|null;created_at:string;post_id:string|null;formal_ids:string[];external_url:string|null;internal_view:string|null;files:{storage_path:string;file_name:string;media_kind:string}[]};
function ProposalFiles({files}:{files:Proposal['files']}){
 const [urls,setUrls]=useState<Record<string,string>>({});
 useEffect(()=>{let active=true;void Promise.all(files.map(async f=>{const r=await supabase.storage.from('game-assets').createSignedUrl(f.storage_path,3600);return [f.storage_path,r.data?.signedUrl||''] as const})).then(x=>{if(active)setUrls(Object.fromEntries(x))});return()=>{active=false}},[files]);
 return <div className="mediaProposalFiles">{files.map(f=>urls[f.storage_path]&&<div key={f.storage_path}>{f.media_kind==='image'?<img src={urls[f.storage_path]} alt={f.file_name}/>:f.media_kind==='video'?<video controls preload="metadata" src={urls[f.storage_path]}/>:f.media_kind==='audio'?<audio controls preload="metadata" src={urls[f.storage_path]}/>:null}<a href={urls[f.storage_path]} target="_blank" rel="noreferrer">{f.file_name}</a></div>)}</div>;
}
export default function NewsProposals({g,refreshKey,onOpenDocument,onNavigate,onPublished}:{g:ReturnTypeRepublic;refreshKey:number;onOpenDocument:(id:string)=>void;onNavigate:(v:View)=>void;onPublished:(title:string)=>void}){
 const [items,setItems]=useState<Proposal[]>([]),[error,setError]=useState(''),[openId,setOpenId]=useState(''),[note,setNote]=useState<Record<string,string>>({}),[busy,setBusy]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{if(!g.game?.id)return;let active=true;async function load(){let query=supabase.from('media_news_proposals').select('*').eq('game_id',g.game!.id).order('created_at',{ascending:false}).limit(50);if(g.teacher)query=query.eq('status','pending');const r=await query;if(active){if(r.error)setError(r.error.message);else{setItems(r.data||[]);setError('')}}}void load();const interval=setInterval(()=>void load(),20000);return()=>{active=false;clearInterval(interval)}},[g.game?.id,g.teacher,refreshKey,refresh]);
 async function review(p:Proposal,approve:boolean){setBusy(p.id);setError('');const r=await supabase.rpc('review_media_news',{p_proposal_id:p.id,p_approve:approve,p_note:note[p.id]||null});if(r.error)setError(r.error.message);else{setRefresh(n=>n+1);await g.refresh();if(approve)onPublished(p.title)}setBusy('')}
 if(!items.length&&!error)return null;
 return <details className="projectDisclosure mediaProposalQueue"><DisclosureSummary icon={Newspaper} title={g.teacher?'Новости для согласования · '+items.length:'Мои предложения в СМИ · '+items.length} description={g.teacher?'Предложения студентов. Публикация появляется в ленте после одобрения.':'Статус рассмотрения и ответ преподавателя'}/><div className="civicDisclosureBody">
  {error&&<p className="error" role="alert">{error}</p>}
  {items.map(p=><article className="mediaProposal" key={p.id}><button type="button" className="mediaProposalHeading" aria-expanded={openId===p.id} onClick={()=>setOpenId(v=>v===p.id?'':p.id)}><div><b>{p.title}</b><small>{g.names[p.author_id]||p.submitted_actor} · {new Date(p.created_at).toLocaleString('ru-RU')}</small></div><span>{p.status==='pending'?'На согласовании':p.status==='approved'?'Опубликовано':'Отклонено'}</span></button>
   {openId===p.id&&<div className="mediaProposalBody"><p className="mediaProposalBy">Предложено от имени: {p.submitted_actor}</p><RichPostText text={p.body} onNavigate={onNavigate} onOpenDocument={onOpenDocument}/>{p.tags.length>0&&<div className="wallTags">{p.tags.map(t=><span key={t}>#{t}</span>)}</div>}{p.files.length>0&&<ProposalFiles files={p.files}/>}<div className="mediaProposalDocuments">{p.formal_ids.map(id=>{const d=g.formalDocuments.find(x=>x.id===id);return d&&<button type="button" className="secondary" key={id} onClick={()=>onOpenDocument(id)}>{d.registry_no} · {d.title}</button>})}</div>{p.external_url&&<a href={p.external_url} target="_blank" rel="noreferrer">Внешний ресурс ↗</a>}{p.internal_view&&<button className="secondary" onClick={()=>onNavigate(p.internal_view as View)}>Открыть связанный раздел</button>}{p.review_note&&<p className="mediaReviewNote"><b>Ответ преподавателя:</b> {p.review_note}</p>}
    {g.teacher&&p.status==='pending'&&<div className="mediaReviewForm"><label>Комментарий к решению<textarea rows={2} value={note[p.id]||''} onChange={e=>setNote(v=>({...v,[p.id]:e.target.value}))} placeholder="Для отказа укажите причину"/></label><div><button type="button" className="secondary" disabled={!!busy||(note[p.id]||'').trim().length<3} onClick={()=>void review(p,false)}><X size={18}/> Отклонить</button><button type="button" className="primary" disabled={!!busy} onClick={()=>void review(p,true)}><Check size={18}/> {busy===p.id?'Сохраняется…':'Опубликовать в СМИ'}</button></div></div>}
   </div>}
  </article>)}
 </div></details>;
}
