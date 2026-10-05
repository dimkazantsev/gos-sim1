'use client';
import {useEffect,useState} from 'react';
import {CheckCircle2,FileUp,Save} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import StyledSelect from '../ui/StyledSelect';
import {DOCUMENT_TEMPLATES} from './documentTemplates';
import {FORMAL_SUBJECTS,FORMAL_TYPES} from './formalInstitutions';
import type {ReturnTypeRepublic} from './viewTypes';
export default function StageDocumentForm({g,templateKey,stageNo,onSaved,onCancel}:{g:ReturnTypeRepublic;templateKey:string;stageNo:number;onSaved:(id:string)=>void;onCancel:()=>void}){
 const t=DOCUMENT_TEMPLATES.find(x=>x.key===templateKey)!;
 const [title,setTitle]=useState(t.title),[body,setBody]=useState(t.body),[subject,setSubject]=useState(t.subject),[allowed,setAllowed]=useState<string[]|null>(null),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [issueDate,setIssueDate]=useState(()=>new Date().toISOString().slice(0,10)),[issuePlace,setIssuePlace]=useState('Москва'),[issuer,setIssuer]=useState(''),[basis,setBasis]=useState('');
 useEffect(()=>{let live=true;if(!g.game)return;void supabase.rpc('get_formal_subjects',{p_game_id:g.game.id}).then(r=>{if(!live)return;if(r.error)setError(userError(r.error));else if(Array.isArray(r.data)){setAllowed(r.data);if(!r.data.includes(t.subject))setSubject(r.data[0]||'')}});return()=>{live=false}},[g.game?.id,g.me?.user_id,templateKey]);
 const subjects=FORMAL_SUBJECTS.filter(s=>allowed?allowed.includes(s.key):g.teacher||s.roleHints.some(h=>(g.me?.role_title||'').toLowerCase().includes(h)));
 async function save(){if(busy||!subject||title.trim().length<3||body.trim().length<10||!issueDate||issuePlace.trim().length<2)return;const s=FORMAL_SUBJECTS.find(x=>x.key===subject)!,type=FORMAL_TYPES.find(x=>x.key===t.docType)!;if(file&&file.size>25*1024*1024){setError('Размер файла не должен превышать 25 МБ.');return}setBusy(true);try{const id=await g.createFormalDocument({stageNo,title:title.trim(),bodyText:body.trim(),docType:t.docType,subjectKey:subject,subjectLabel:s.label,workflowKey:type.workflow,metadata:{template_key:t.key,stage_form:true,issue_date:issueDate,issue_place:issuePlace.trim(),issuer:issuer.trim()||s.label,basis:basis.trim()||null}},file||undefined);if(id){setError('');onSaved(id)}}catch(e){setError(userError(e))}finally{setBusy(false)}}
 return <form className="stageDocumentForm stageDocumentFormFull" onSubmit={e=>{e.preventDefault();void save()}}>
 <header><div><small>Документ этапа {stageNo}</small><h4>{t.title}</h4></div><FileUp size={24}/></header>
 <p>Можно заполнить документ прямо здесь или приложить готовый файл. Система присвоит реестровый номер и свяжет документ с этапом; все реквизиты сохраняются вместе с НПА.</p>
 <section className="stageDocumentSection"><div className="stageDocumentSectionHead"><small>01</small><div><b>Реквизиты</b><span>Кто, где и когда оформляет документ</span></div></div>
  <div className="stageDocumentFields">
   <label>Название документа<input aria-label="Название документа" value={title} onChange={e=>setTitle(e.target.value)} required minLength={3}/></label>
   <StyledSelect label="Субъект / автор документа" value={subject} onChange={setSubject} options={subjects.map(s=>({value:s.key,label:s.label}))}/>
   <label>Дата документа<input aria-label="Дата документа" type="date" value={issueDate} onChange={e=>setIssueDate(e.target.value)} required/></label>
   <label>Место принятия / составления<input aria-label="Место принятия документа" value={issuePlace} onChange={e=>setIssuePlace(e.target.value)} placeholder="Москва" required minLength={2}/></label>
   <label className="stageDocumentWide">Орган, инициатор или должностное лицо<input aria-label="Издавший орган или инициатор" value={issuer} onChange={e=>setIssuer(e.target.value)} placeholder="Если не указано, используется выбранный субъект"/></label>
  </div>
 </section>
 <section className="stageDocumentSection"><div className="stageDocumentSectionHead"><small>02</small><div><b>Содержание</b><span>Заполните все поля шаблона и фактическое основание</span></div></div>
  <div className="stageDocumentFields">
   <label className="stageDocumentBody">Текст документа<textarea aria-label="Текст документа" rows={16} value={body} onChange={e=>setBody(e.target.value)} required minLength={10}/></label>
   <label className="stageDocumentBody stageDocumentBasis">Основание / пояснение к документу<textarea aria-label="Основание документа" rows={4} value={basis} onChange={e=>setBasis(e.target.value)} placeholder="Укажите решение, событие, поручение, итоги заседания или иное основание."/></label>
  </div>
 </section>
 <section className="stageDocumentSection"><div className="stageDocumentSectionHead"><small>03</small><div><b>Файл и приложения</b><span>Загрузите готовый оригинал или приложения к заполненному тексту</span></div></div>
  <div className="stageDocumentFields"><label className="stageDocumentUpload">Приложение / оригинал документа<input aria-label="Приложение к документу" type="file" accept=".pdf,.doc,.docx,.odt,.txt,.rtf,.xlsx,.xls,.png,.jpg,.jpeg" onChange={e=>setFile(e.target.files?.[0]||null)}/><small>{file?file.name+' · '+Math.ceil(file.size/1024)+' КБ':'Файл необязателен · PDF, DOC(X), XLS(X), изображения и текст · до 25 МБ'}</small></label></div>
 </section>
 {!subjects.length&&<p role="status">Для создания этого документа выберите назначенную игровую должность в профиле.</p>}
 {error&&<p role="alert" className="error">{error}</p>}
 <footer><button type="button" className="secondary" onClick={onCancel} disabled={busy}>Отмена</button><button type="submit" className="primary" disabled={busy||!subject||!subjects.some(s=>s.key===subject)||title.trim().length<3||body.trim().length<10||!issueDate||issuePlace.trim().length<2}><Save size={18}/>{busy?'Сохранение…':'Сохранить документ в реестр'}</button></footer>
 <p className="stageDocumentHint"><CheckCircle2 size={17}/> После сохранения документ появится в результатах этапа и в Реестре НПА.</p>
 </form>;
}
