'use client';
import {useRef,useState} from 'react';
import {Link2,Save,X} from 'lucide-react';
import type {PoliticalPost} from './types';
import type {ReturnTypeRepublic} from './viewTypes';
import MediaUploadButton from './MediaUploadButton';
import FormalDocumentPicker from './FormalDocumentPicker';
import StyledSelect from '../ui/StyledSelect';
import {PROCESS_TAGS} from './processTags';
const types=[['statement','Заявление'],['initiative','Инициатива'],['decision','Проект решения'],['event','Событие'],['negotiation','Переговоры'],['crisis_response','Антикризисная мера'],['information','Информационное сообщение'],['news','Новость СМИ']];
const resources=[['actions','Политический процесс'],['documents','Реестр НПА'],['votes','Голосования'],['parties','Партии'],['stages','Этапы'],['events','События'],['dashboard','Обзор игры']];
export default function PostInlineEditor({post:p,g,onClose,onSaved}:{post:PoliticalPost;g:ReturnTypeRepublic;onClose:()=>void;onSaved:()=>void}){
 const [title,setTitle]=useState(p.title),[body,setBody]=useState(p.body),[type,setType]=useState(p.process_type),[tags,setTags]=useState(p.tags||[]),[external,setExternal]=useState(p.external_url||''),[internal,setInternal]=useState(p.internal_view||'');
 const [ids,setIds]=useState(g.postFormalLinks.filter(l=>l.post_id===p.id).map(l=>l.formal_document_id)),[files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [linkOpen,setLinkOpen]=useState(false),[linkLabel,setLinkLabel]=useState(''),[linkUrl,setLinkUrl]=useState(''),[linkView,setLinkView]=useState('');
 const input=useRef<HTMLTextAreaElement>(null);
 function insert(text:string){const start=input.current?.selectionStart??body.length,end=input.current?.selectionEnd??body.length;setBody(body.slice(0,start)+text+body.slice(end));requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(start+text.length,start+text.length)})}
 async function save(){if(busy)return;setBusy(true);setError('');const ok=await g.updatePoliticalPost(p.id,{title,body,processType:type,tags:Array.from(new Set([...tags,...Array.from(body.matchAll(/#([а-яёa-z0-9_]+)/gi),m=>m[1])])),externalUrl:external,internalView:internal,formalIds:ids},files);if(ok)onSaved();else setError('Изменения не сохранены. Проверьте сообщение об ошибке системы.');setBusy(false)}
 return <section className="processInlineEditor" aria-label="Редактирование публикации"><header><div><h3>Редактирование публикации</h3><p>{p.actor_label}</p></div><button type="button" className="processEditorClose" disabled={busy} onClick={onClose} aria-label="Отменить редактирование публикации"><X size={20}/></button></header>
  <div className="wallComposerGrid"><StyledSelect label="Вид публикации" value={type} onChange={setType} options={types.map(([value,label])=>({value,label}))}/><label>Заголовок<input aria-label="Редактируемый заголовок публикации" value={title} onChange={e=>setTitle(e.target.value)}/></label></div>
  <label className="processTextField">Текст публикации<textarea ref={input} aria-label="Редактируемый текст публикации" rows={7} value={body} onChange={e=>setBody(e.target.value)}/></label>
  <div className="processTagPicker"><span>Добавить тег в текст</span><div>{PROCESS_TAGS.map(t=><button type="button" key={t.key} aria-pressed={tags.includes(t.key)} onClick={()=>{if(!tags.includes(t.key))setTags(v=>[...v,t.key]);if(!body.includes('#'+t.key))insert(' #'+t.key+' ')}}>{t.label}<small>#{t.key}</small></button>)}</div></div>
  <div className="processAttachmentTools"><MediaUploadButton files={files} onChange={setFiles} label="Фото, видео, аудио или файл" hint="До 12 вложений"/><FormalDocumentPicker documents={g.formalDocuments} value={ids} onChange={setIds}/><button type="button" className="secondary" onClick={()=>setLinkOpen(v=>!v)}><Link2 size={18}/> Ссылка в тексте</button></div>
  {linkOpen&&<div className="processInlineLinkEditor"><label>Текст ссылки<input value={linkLabel} onChange={e=>setLinkLabel(e.target.value)}/></label><StyledSelect label="Внутренний ресурс" value={linkView} onChange={setLinkView} options={[{value:'',label:'Внешняя ссылка'},...resources.map(([value,label])=>({value,label}))]}/>{!linkView&&<label>Адрес<input type="url" value={linkUrl} onChange={e=>setLinkUrl(e.target.value)}/></label>}<button type="button" className="secondary" disabled={!linkLabel.trim()||!linkView&&!/^https?:\/\/\S+$/.test(linkUrl.trim())} onClick={()=>{insert('['+linkLabel.trim().replace(/[\[\]\n]/g,'')+']('+(linkView?'gos:'+linkView:linkUrl.trim())+')');setLinkOpen(false)}}>Вставить ссылку</button></div>}
  <div className="processEditorResources"><label>Внешний ресурс<input type="url" value={external} onChange={e=>setExternal(e.target.value)} placeholder="https://…"/></label><StyledSelect label="Раздел игры" value={internal} onChange={setInternal} options={[{value:'',label:'Без ссылки'},...resources.map(([value,label])=>({value,label}))]}/></div>
  {error&&<p role="alert" className="error">{error}</p>}
  <footer><button type="button" className="secondary" disabled={busy} onClick={onClose}>Отмена</button><button type="button" className="primary" disabled={busy||title.trim().length<3||body.trim().length<3} onClick={()=>void save()}><Save size={18}/> {busy?'Сохраняется…':'Сохранить изменения'}</button></footer>
 </section>;
}
