'use client';

import {useEffect,useMemo,useState} from 'react';
import {ArrowUpRight,FileCheck2,FilePlus2,FileText,FolderOpen,Paperclip,RefreshCcw,UploadCloud} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {FORMAL_SUBJECTS} from './formalInstitutions';
import {isStageWorkOpen} from './stageWorkStatus';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Stage} from './types';
import styles from './Stage12BillPackages.module.css';

type BillFile={id:string;document_id:string;file_kind:string;title:string;file_name:string;storage_path:string;status:string;note:string|null};
const KINDS=[
 {key:'explanatory_note',label:'Пояснительная записка',required:true},
 {key:'affected_acts',label:'Перечень затрагиваемых актов',required:true},
 {key:'financial_economic',label:'Финансово-экономическое обоснование',required:false},
 {key:'government_opinion',label:'Заключение Правительства РФ',required:false},
 {key:'collegial_decision',label:'Решение коллегиального субъекта',required:false},
 {key:'other_review',label:'Дополнительное заключение',required:false}
] as const;
const ALLOWED_SUBJECTS=['gd_deputy','sf_member','region','ks','vs','government','president','sf'];
const MAX_FILE_BYTES=10*1024*1024;
const fileAccept='.pdf,.doc,.docx,.odt,.txt,.rtf';
const labelFor=(key:string)=>KINDS.find(k=>k.key===key)?.label||key;
const editable=(status:string)=>['draft','revision','registered'].includes(status);
function validateFile(file:File){
 const extension=file.name.split('.').pop()?.toLowerCase()||'';
 return file.size>0&&file.size<=MAX_FILE_BYTES&&['pdf','doc','docx','odt','txt','rtf'].includes(extension);
}
export default function Stage12BillPackages({g,stage,readOnly=false,subjects=[],onOpenDocument,onOpenVotes}:{
 g:ReturnTypeRepublic;stage:Stage;readOnly?:boolean;subjects?:string[];
 onOpenDocument?:(id:string)=>void;onOpenVotes:(id?:string)=>void;
}){
 const bills=useMemo(()=>g.formalDocuments.filter(d=>d.stage_no===12&&d.workflow_key==='bill').sort((a,b)=>b.created_at.localeCompare(a.created_at)),[g.formalDocuments]);
 const [visible,setVisible]=useState(12);
 const visibleBills=bills.slice(0,visible);
 const billIds=visibleBills.map(d=>d.id).join(',');
 const [files,setFiles]=useState<BillFile[]>([]);
 const [loading,setLoading]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const [createOpen,setCreateOpen]=useState(false);
 const [title,setTitle]=useState('');
 const [body,setBody]=useState('');
 const [type,setType]=useState<'fz_bill'|'fkz_bill'>('fz_bill');
 const [subject,setSubject]=useState('');
 const [mainFile,setMainFile]=useState<File|null>(null);
 const [attachments,setAttachments]=useState<Record<string,File|null>>({});
 const [financial,setFinancial]=useState(false);
 const [opinion,setOpinion]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [uploadId,setUploadId]=useState('');
 const [uploadKind,setUploadKind]=useState('explanatory_note');
 const [uploadFile,setUploadFile]=useState<File|null>(null);
 const allowed=FORMAL_SUBJECTS.filter(s=>ALLOWED_SUBJECTS.includes(s.key)&&(g.teacher||subjects.includes(s.key)));
 const activeSubject=allowed.some(s=>s.key===subject)?subject:(allowed[0]?.key||'');
 const canCreate=!readOnly&&!!g.game&&!!g.me&&g.me.kind!=='observer'&&
   (g.teacher||isStageWorkOpen(g.game,stage))&&allowed.length>0;
 const ownerCanEdit=(document:{author_id:string;status_code:string})=>
  !readOnly&&!!g.me&&g.me.kind!=='observer'&&
  (g.teacher||g.me.user_id===document.author_id)&&editable(document.status_code)&&
  (g.teacher||isStageWorkOpen(g.game,stage));

 useEffect(()=>{
  let live=true;
  if(!g.game||!billIds){setFiles([]);setLoading(false);return;}
  setLoading(true);
  const ids=billIds.split(',');
  void (async()=>{
   const response=await supabase.from('bill_package_files')
     .select('id,document_id,file_kind,title,file_name,storage_path,status,note')
     .eq('game_id',g.game!.id).in('document_id',ids)
     .order('created_at',{ascending:false}).limit(160);
   if(!live)return;
   if(response.error)g.setError(response.error);
   else setFiles((response.data||[]) as BillFile[]);
   setLoading(false);
  })();
  return()=>{live=false};
 // Deliberately keyed by stable ID set rather than changing game object identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[g.game?.id,billIds,refresh]);

 async function addAttachment(documentId:string,kind:string,file:File){
  if(!g.game)return 'Игра не найдена';
  if(!validateFile(file))return 'Недопустимый файл (PDF, DOC, DOCX, ODT, TXT, RTF; не более 10 МБ)';
  const ext=file.name.split('.').pop()?.toLowerCase()||'bin';
  const path=g.game.id+'/formal/'+documentId+'/package/'+crypto.randomUUID()+'.'+ext;
  const uploaded=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||'application/octet-stream'});
  if(uploaded.error)return uploaded.error.message;
  const linked=await supabase.rpc('add_bill_package_file',{
   p_document_id:documentId,p_file_kind:kind,p_title:labelFor(kind),
   p_storage_path:path,p_file_name:file.name,p_mime_type:file.type||null,p_file_size:file.size
  });
  return linked.error?.message||'';
 }

 async function create(){
  if(!canCreate||busy||!activeSubject)return;
  if(title.trim().length<5||(!body.trim()&&!mainFile)){setMessage('Укажите название и текст законопроекта либо прикрепите его файл.');return;}
  if(mainFile&&!validateFile(mainFile)){setMessage('Файл законопроекта должен быть PDF, DOC, DOCX, ODT, TXT или RTF размером до 10 МБ.');return;}
  const selectedSubject=allowed.find(s=>s.key===activeSubject);
  if(!selectedSubject)return;
  setBusy(true);setMessage('');
  try{
   const id=await g.createFormalDocument({
    stageNo:12,title:title.trim(),docType:type,subjectKey:activeSubject,
    subjectLabel:selectedSubject.label,bodyText:body.trim(),workflowKey:'bill',
    metadata:{template_key:type,created_from_stage12_package:true}
   },mainFile||undefined);
   if(!id){setMessage('Пакет не создан. Проверьте полномочия и доступность Этапа 12.');return;}
   const issues:string[]=[];
   const profile=await supabase.rpc('save_bill_submission_profile',{
    p_document_id:id,p_requires_financial_justification:financial,
    p_requires_government_opinion:opinion,p_committee_key:null,
    p_representative_user_id:null,p_note:null
   });
   if(profile.error)issues.push('Карточка внесения: '+profile.error.message);
   for(const [kind,file] of Object.entries(attachments)){
    if(!file)continue;
    const problem=await addAttachment(id,kind,file);
    if(problem)issues.push(labelFor(kind)+': '+problem);
   }
   setCreateOpen(false);setTitle('');setBody('');setMainFile(null);setAttachments({});
   setFinancial(false);setOpinion(false);setRefresh(v=>v+1);
   setMessage(issues.length?'Законопроект создан, но некоторые материалы не сохранены: '+issues.join(' · '):
    'Пакет зарегистрирован в Реестре НПА. Документы прикреплены к законопроекту и будут следовать его маршруту.');
   onOpenDocument?.(id);
  }catch(error){g.setError(error)}
  finally{setBusy(false)}
 }

 async function attach(id:string){
  if(!uploadFile||busy)return;
  setBusy(true);setMessage('');
  try{
   const problem=await addAttachment(id,uploadKind,uploadFile);
   if(problem){setMessage('Материал не прикреплён: '+problem);return}
   setUploadFile(null);setUploadId('');setRefresh(x=>x+1);
   setMessage('Материал добавлен к пакету. Он будет доступен другим участникам игры в досье НПА.');
  }finally{setBusy(false)}
 }

 async function openFile(file:BillFile){
  if(!g.game)return;
  // Reserve the user-initiated tab before the signed-URL request. Creating a
  // window after an awaited network request is blocked by many phone browsers.
  const tab=window.open('about:blank','_blank');
  if(tab)tab.opener=null;
  const signed=await supabase.storage.from('game-assets').createSignedUrl(file.storage_path,60);
  if(signed.error||!signed.data?.signedUrl){
   tab?.close();g.setError(signed.error||'Не удалось открыть файл');return;
  }
  if(tab)tab.location.replace(signed.data.signedUrl);
  else setMessage('Браузер заблокировал открытие файла. Разрешите всплывающие окна для ГОС.ID.');
 }

 return <section className={styles.section} aria-label="Пакеты законодательных инициатив">
  <header className={styles.heading}>
   <div><small>Материалы Этапа 12 · Законодательная инициатива</small>
    <h3>Пакеты законопроектов</h3>
    <p>Каждый законопроект создаётся одним пакетом: текст закона, пояснительная записка, перечень актов и необходимые заключения. Другие участники видят его состав и могут подготовить собственный пакет.</p>
   </div>
   {canCreate&&<button className="primary" type="button" onClick={()=>setCreateOpen(x=>!x)} aria-expanded={createOpen}>
    <FilePlus2 size={18}/>{createOpen?'Свернуть форму':'Создать пакет'}
   </button>}
  </header>
  {message&&<p className={styles.notice} role="status">{message}</p>}
  {createOpen&&canCreate&&<div className={styles.form}>
   <h4>Новая законодательная инициатива</h4>
   <div className={styles.fields}>
    <label>Вид закона<select value={type} onChange={e=>setType(e.target.value as 'fz_bill'|'fkz_bill')}>
      <option value="fz_bill">Федеральный закон</option><option value="fkz_bill">Федеральный конституционный закон</option>
    </select></label>
    <label>Субъект законодательной инициативы<select value={activeSubject} onChange={e=>setSubject(e.target.value)}>
     {allowed.map(s=><option value={s.key} key={s.key}>{s.label}</option>)}
    </select></label>
    <label className={styles.full}>Название законопроекта<input value={title} maxLength={220} onChange={e=>setTitle(e.target.value)} placeholder="О внесении изменений в Федеральный закон…"/></label>
    <label className={styles.full}>Текст проекта закона<textarea rows={5} value={body} onChange={e=>setBody(e.target.value)} placeholder="Текст проекта либо прикреплённый ниже файл"/></label>
    <label className={styles.full}>Файл проекта закона (вместо текста или вместе с ним)
     <input type="file" accept={fileAccept} onChange={e=>setMainFile(e.target.files?.[0]||null)}/></label>
   </div>
   <div className={styles.checks}>
    <label><input type="checkbox" checked={financial} onChange={e=>setFinancial(e.target.checked)}/> Требуется финансово-экономическое обоснование</label>
    <label><input type="checkbox" checked={opinion} onChange={e=>setOpinion(e.target.checked)}/> Требуется заключение Правительства</label>
   </div>
   <h4>Файлы пакета</h4>
   <div className={styles.attachGrid}>{KINDS.filter(x=>x.required||(x.key==='financial_economic'&&financial)||(x.key==='government_opinion'&&opinion)).map(kind=>
    <label key={kind.key} className={styles.attachment}><span>{kind.label}{kind.required?' · Обязательно':''}</span>
     <input type="file" accept={fileAccept} onChange={e=>setAttachments(old=>({...old,[kind.key]:e.target.files?.[0]||null}))}/></label>
   )}</div>
   <p className={styles.hint}>Профильный комитет, представитель и дальнейшие согласования заполняются в открытом досье пакета. Документы связываются с одним номером НПА. Файлы — не более 10 МБ каждый.</p>
   <button type="button" className="primary" disabled={busy||title.trim().length<5||(!body.trim()&&!mainFile)} onClick={()=>void create()}>
    <UploadCloud size={18}/>{busy?'Сохранение пакета…':'Создать и загрузить пакет'}
   </button>
  </div>}
  {!canCreate&&!readOnly&&<p className={styles.hint}>Создавать пакет может участник с полномочиями субъекта законодательной инициативы во время открытого этапа. Просмотр доступен всем участникам игры.</p>}
  <div className={styles.listTitle}><h4>Реестр пакетов · {bills.length}</h4>
   <button className="secondary" type="button" disabled={loading} onClick={()=>setRefresh(x=>x+1)}><RefreshCcw size={16}/>Обновить состав</button>
  </div>
  {!bills.length?<div className={styles.empty}>Законопроекты Этапа 12 ещё не зарегистрированы. Уполномоченный участник может создать первый пакет.</div>:
   <div className={styles.list}>{visibleBills.map(d=>{
    const billFiles=files.filter(f=>f.document_id===d.id);
    const required=KINDS.filter(k=>k.required);
    const attached=required.filter(k=>billFiles.some(f=>f.file_kind===k.key)).length;
    const isOwner=ownerCanEdit(d);
    const openVotes=g.votes.filter(v=>v.formal_document_id===d.id&&v.status==='open');
    return <article key={d.id} className={styles.card}>
     <div className={styles.cardHeader}>
      <div className={styles.cardTitle}><FolderOpen size={20}/><div><small>{d.registry_no} · {d.status_label}</small><h4>{d.title}</h4></div></div>
      <span className={styles.count}>{attached}/{required.length} основных приложений</span>
     </div>
     <div className={styles.fileList}>{billFiles.length?billFiles.map(f=>
      <button type="button" key={f.id} className={styles.file} onClick={()=>void openFile(f)} title="Открыть файл">
       <Paperclip size={16}/><span><b>{labelFor(f.file_kind)}</b><small>{f.file_name} · {f.status==='accepted'?'Принят':f.status==='revision'?'Нужна доработка':'На рассмотрении'}</small></span><ArrowUpRight size={16}/>
      </button>):<p className={styles.hint}>Приложения ещё не загружены.</p>}</div>
     <div className={styles.cardActions}>
      <button type="button" className="secondary" disabled={!onOpenDocument} onClick={()=>onOpenDocument?.(d.id)}>
       <FileText size={17}/>Открыть пакет, маршрут и поправки</button>
      {openVotes.length>0&&<button type="button" className="secondary" onClick={()=>onOpenVotes(openVotes[0].id)}>Открыть голосование</button>}
      {isOwner&&<button type="button" className="secondary" onClick={()=>setUploadId(old=>old===d.id?'':d.id)} aria-expanded={uploadId===d.id}><FileCheck2 size={17}/>Дополнить пакет</button>}
     </div>
     {isOwner&&uploadId===d.id&&<div className={styles.inlineUpload}>
      <label>Вид приложения<select value={uploadKind} onChange={e=>setUploadKind(e.target.value)}>{KINDS.map(k=><option value={k.key} key={k.key}>{k.label}</option>)}</select></label>
      <label>Файл<input type="file" accept={fileAccept} onChange={e=>setUploadFile(e.target.files?.[0]||null)}/></label>
      <button type="button" className="primary" disabled={busy||!uploadFile} onClick={()=>void attach(d.id)}>{busy?'Загрузка…':'Прикрепить'}</button>
     </div>}
    </article>
   })}</div>}
  {bills.length>visible&&<button className="secondary" type="button" onClick={()=>setVisible(v=>v+12)}>Показать ещё пакеты</button>}
  <p className={styles.hint}>Пакет движется по маршруту НПА целиком: регистрация, комитет, чтения, Совет Федерации и Президент. Поправки ко II чтению вносятся к этому же законопроекту внутри его досье. Отдельное движение каждого приложения не требуется.</p>
 </section>;
}
