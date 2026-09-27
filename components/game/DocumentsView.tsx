'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {FormalDocument} from './types';
import {FORMAL_SUBJECTS,FORMAL_TYPES,inferFormal,formalSignature,ownerLabel} from './formalInstitutions';

function typeLabel(key:string){return FORMAL_TYPES.find(x=>x.key===key)?.label||key}
function shortDate(v:string){return new Date(v).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})}
function fmtDateTime(v:string){return new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function statusTone(code:string){if(['published','signed','adopted'].includes(code))return 'ok';if(['rejected','revision'].includes(code))return 'bad';if(code==='draft')return 'draft';return 'progress'}

export default function DocumentsView({g}:{g:ReturnTypeRepublic}){
 const {formalDocuments,formalHistory,members,me,teacher,currentStage,createFormalDocument,advanceFormalDocument,updateFormalDraft}=g;
 const [mode,setMode]=useState<'registry'|'create'>('registry'),[selectedId,setSelectedId]=useState(''),[query,setQuery]=useState(''),[filterSubject,setFilterSubject]=useState(''),[filterStatus,setFilterStatus]=useState('');
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[subjectKey,setSubjectKey]=useState('gd_deputy'),[docType,setDocType]=useState('fz_bill'),[file,setFile]=useState<File|null>(null),[extracting,setExtracting]=useState(false),[recognized,setRecognized]=useState(''),[busy,setBusy]=useState(false);
 const [editing,setEditing]=useState(false),[editTitle,setEditTitle]=useState(''),[editBody,setEditBody]=useState('');

 const role=(me?.role_title||'').toLowerCase();
 const availableSubjects=useMemo(()=>teacher?FORMAL_SUBJECTS:FORMAL_SUBJECTS.filter(s=>s.roleHints.some(h=>role.includes(h))),[teacher,role]);
 const selected=useMemo(()=>formalDocuments.find(d=>d.id===selectedId)||formalDocuments[0],[formalDocuments,selectedId]);
 const filtered=useMemo(()=>formalDocuments.filter(d=>{const q=query.trim().toLowerCase();return(!q||[d.registry_no,d.title,d.subject_label,typeLabel(d.doc_type),d.status_label].join(' ').toLowerCase().includes(q))&&(!filterSubject||d.subject_key===filterSubject)&&(!filterStatus||d.status_code===filterStatus)}),[formalDocuments,query,filterSubject,filterStatus]);
 const history=selected?formalHistory.filter(h=>h.document_id===selected.id).slice().reverse():[];
 const author=selected?members.find(m=>m.user_id===selected.author_id):undefined;
 const subject=selected?FORMAL_SUBJECTS.find(s=>s.key===selected.subject_key):undefined;
 const signatureHolder=selected?(members.find(m=>subject?.roleHints.some(h=>(m.role_title||'').toLowerCase().includes(h)))||author):undefined;
 const signature=selected?formalSignature(selected.subject_key,signatureHolder?.full_name||author?.full_name||'________________'):null;

 function canManage(doc:FormalDocument){
  if(teacher)return true;if(!me)return false;if(doc.current_owner_key==='author')return doc.author_id===me.user_id;
  const rt=(me.role_title||'').toLowerCase();
  if(doc.current_owner_key==='president')return rt.includes('президент');
  if(doc.current_owner_key==='gd')return rt.includes('депутат')||(rt.includes('государственн')&&rt.includes('дум'));
  if(doc.current_owner_key==='gd_staff'||doc.current_owner_key==='gd_council')return (rt.includes('председател')&&rt.includes('дум'))||(rt.includes('совет')&&rt.includes('дум'));
  if(doc.current_owner_key==='committee')return rt.includes('комитет')||rt.includes('депутат');
  if(doc.current_owner_key==='sf')return rt.includes('совет федерац')||rt.includes('сенатор');
  if(doc.current_owner_key==='government')return rt.includes('правительств')||rt.includes('министр');
  if(doc.current_owner_key==='ministry')return rt.includes('министр')||rt.includes('министерств');
  if(doc.current_owner_key==='municipality')return rt.includes('муницип')||rt.includes('глава города')||rt.includes('администрац');
  return false;
 }

 function applyInference(nextBody=body,nextTitle=title){
  const found=inferFormal(nextBody,nextTitle,me?.role_title);
  if(teacher||availableSubjects.some(s=>s.key===found.subject.key))setSubjectKey(found.subject.key);else if(availableSubjects[0])setSubjectKey(availableSubjects[0].key);
  setDocType(found.type.key);setRecognized('Распознано: '+found.type.label+' · '+found.subject.short);
 }

 async function extractFile(next:File){
  setFile(next);setExtracting(true);setRecognized('');
  try{
   const fd=new FormData();fd.append('file',next);
   const res=await fetch('/api/extract-document',{method:'POST',body:fd});const data=await res.json();
   if(!res.ok){setRecognized(data.error||'Не удалось распознать текст. Файл всё равно можно прикрепить.');return}
   if(data.text){
    setBody(data.text);const baseTitle=title||next.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ');if(!title)setTitle(baseTitle);
    const found=inferFormal(data.text,baseTitle,me?.role_title);
    if(teacher||availableSubjects.some(s=>s.key===found.subject.key))setSubjectKey(found.subject.key);else if(availableSubjects[0])setSubjectKey(availableSubjects[0].key);
    setDocType(found.type.key);setRecognized('✓ Текст извлечён'+(data.pages?' · '+data.pages+' стр.':'')+' · '+found.type.label+' · '+found.subject.short);
   }
  }catch(e){setRecognized(e instanceof Error?e.message:'Ошибка распознавания')}finally{setExtracting(false)}
 }

 function chooseSubject(key:string){setSubjectKey(key);const s=FORMAL_SUBJECTS.find(x=>x.key===key);if(s){const current=FORMAL_TYPES.find(x=>x.key===docType);if(!current||current.workflow==='generic'||current.key==='other')setDocType(s.defaultType)}}

 async function create(){
  const s=FORMAL_SUBJECTS.find(x=>x.key===subjectKey),t=FORMAL_TYPES.find(x=>x.key===docType);if(!s||!t||title.trim().length<3)return;
  const holder=members.find(m=>s.roleHints.some(h=>(m.role_title||'').toLowerCase().includes(h)))||me;const signatureMeta=formalSignature(s.key,holder?.full_name||me?.full_name||'');
  setBusy(true);
  const id=await createFormalDocument({stageNo:currentStage?.stage_no||12,title:title.trim(),docType:t.key,subjectKey:s.key,subjectLabel:s.label,bodyText:body,workflowKey:t.workflow,metadata:{signature_title:signatureMeta.title,signature_name:signatureMeta.name,institution:s.label,recognized:recognized||null,created_in_editor:!file}},file||undefined);
  setBusy(false);if(id){setSelectedId(id);setMode('registry');setTitle('');setBody('');setFile(null);setRecognized('')}
 }

 function startEdit(doc:FormalDocument){setEditTitle(doc.title);setEditBody(doc.body_text||'');setEditing(true)}
 async function saveEdit(){if(!selected)return;setBusy(true);const ok=await updateFormalDraft(selected.id,editTitle,editBody,selected.metadata);setBusy(false);if(ok)setEditing(false)}

 const currentAction=selected?.workflow_steps[selected.current_step]?.action;
 const progress=selected?Math.round((selected.current_step/Math.max(1,selected.workflow_steps.length-1))*100):0;

 return <div className="formalPage">
  <section className="formalHero"><div><small>ФОРМАЛЬНЫЕ ИНСТИТУТЫ · НПА</small><h1>Система нормативной деятельности государства</h1><p>Учебный реестр актов: создание, регистрация, рассмотрение, чтения, одобрение, подписание и опубликование. Движение каждого документа видно всем участникам.</p></div><div className="formalHeroActions"><a href="https://sozd.duma.gov.ru/" target="_blank" rel="noreferrer">СОЗД ГД ↗</a><a href="https://publication.pravo.gov.ru/" target="_blank" rel="noreferrer">Официальное опубликование ↗</a><button className="primary" onClick={()=>setMode('create')}>＋ Создать документ</button></div></section>

  <section className="formalStats"><article><small>ВСЕГО В РЕЕСТРЕ</small><strong>{formalDocuments.length}</strong><span>документов</span></article><article><small>В ПРОЦЕССЕ</small><strong>{formalDocuments.filter(d=>!['published','rejected'].includes(d.status_code)).length}</strong><span>движутся по процедуре</span></article><article><small>ЗАВЕРШЕНО</small><strong>{formalDocuments.filter(d=>['published','signed','adopted'].includes(d.status_code)).length}</strong><span>принятых актов</span></article><article><small>МОИ ДОКУМЕНТЫ</small><strong>{formalDocuments.filter(d=>d.author_id===me?.user_id).length}</strong><span>инициировано вами</span></article></section>

  <div className="formalTabs"><button className={mode==='registry'?'active':''} onClick={()=>setMode('registry')}>Реестр НПА</button><button className={mode==='create'?'active':''} onClick={()=>setMode('create')}>Создать / загрузить</button></div>

  {mode==='create'&&<section className="formalCreate"><aside className="formalCreateGuide"><small>НОВЫЙ ДОКУМЕНТ</small><h2>Создайте внутри или загрузите готовый</h2><p>Система извлечёт текст из PDF/DOCX/TXT, попробует определить вид акта и субъект, а затем построит правильный маршрут движения.</p><ol><li><b>1</b><span>Вставьте текст или загрузите файл</span></li><li><b>2</b><span>Проверьте вид акта и субъект</span></li><li><b>3</b><span>Зарегистрируйте документ</span></li></ol><div className="formalRoleHint"><small>ВАША ИГРОВАЯ РОЛЬ</small><b>{me?.role_title||'Не назначена'}</b><p>{teacher?'Преподаватель может создавать документы от любого института.':availableSubjects.length?'Доступные субъекты: '+availableSubjects.map(x=>x.short).join(', '):'Для вашей роли пока не определён субъект нормативной деятельности.'}</p></div></aside>
   <div className="formalCreateForm"><div className="formalInputBlock"><label>Название документа</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Например: О внесении изменений в Федеральный закон…"/></div><div className="formalFileDrop"><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={e=>{const x=e.target.files?.[0];if(x)void extractFile(x)}}/><div><span>⇧</span><b>{file?file.name:'Загрузить PDF, DOCX или TXT'}</b><small>{extracting?'Извлекаю текст…':'Можно также просто вставить текст ниже'}</small></div></div><div className="formalEditorHead"><label>Текст документа</label><button onClick={()=>applyInference()}>◇ Распознать ещё раз</button></div><textarea className="formalTextEditor" value={body} onChange={e=>setBody(e.target.value)} placeholder="Вставьте полный текст документа…"/>{recognized&&<div className="recognitionResult">{recognized}</div>}<div className="formalRecognitionGrid"><label>Субъект<select value={subjectKey} onChange={e=>chooseSubject(e.target.value)}>{(teacher?FORMAL_SUBJECTS:availableSubjects).map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label><label>Вид документа<select value={docType} onChange={e=>setDocType(e.target.value)}>{FORMAL_TYPES.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label></div><div className="formalCreateFooter"><span>Этап игры: {currentStage?.stage_no||'—'} · {currentStage?.title}</span><button className="primary" disabled={busy||title.trim().length<3||(!teacher&&!availableSubjects.length)} onClick={create}>{busy?'Регистрирую…':'Зарегистрировать в системе →'}</button></div></div>
  </section>}

  {mode==='registry'&&<section className="formalWorkspace"><aside className="formalRegistry"><div className="formalRegistryHead"><div><small>РЕЕСТР</small><h2>Нормативные документы</h2></div><button onClick={()=>setMode('create')}>＋</button></div><input className="formalSearch" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск по номеру, названию, субъекту…"/><div className="formalFilters"><select value={filterSubject} onChange={e=>setFilterSubject(e.target.value)}><option value="">Все субъекты</option>{FORMAL_SUBJECTS.map(s=><option key={s.key} value={s.key}>{s.short}</option>)}</select><select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="">Все стадии</option><option value="draft">Черновик</option><option value="registered">Регистрация</option><option value="committee">Комитет</option><option value="reading1">I чтение</option><option value="reading2">II чтение</option><option value="reading3">III чтение</option><option value="president">Президент</option><option value="published">Опубликован</option><option value="rejected">Отклонён</option></select></div><div className="formalRegistryList">{filtered.length?filtered.map(d=><button key={d.id} className={selected?.id===d.id?'formalRegistryRow active':'formalRegistryRow'} onClick={()=>setSelectedId(d.id)}><div className="formalRegistryNo">{d.registry_no}</div><b>{d.title}</b><span>{d.subject_label}</span><div><em className={`formalStatus ${statusTone(d.status_code)}`}>{d.status_label}</em><time>{shortDate(d.updated_at)}</time></div></button>):<div className="emptyState">По этому фильтру документов нет.</div>}</div></aside>

   <main className="formalDetail">{!selected?<div className="formalEmptyBig"><span>▤</span><h2>Реестр пока пуст</h2><p>Создайте первый нормативный документ — он появится здесь и начнёт движение по процедуре.</p><button className="primary" onClick={()=>setMode('create')}>Создать документ</button></div>:<>
    <header className="formalDocHeader"><div><small>{selected.registry_no} · ЭТАП {selected.stage_no}</small><h2>{selected.title}</h2><p>{typeLabel(selected.doc_type)} · {selected.subject_label}</p></div><div className={`formalStatusLarge ${statusTone(selected.status_code)}`}><small>ТЕКУЩАЯ СТАДИЯ</small><b>{selected.status_label}</b><span>{ownerLabel(selected.current_owner_key)}</span></div></header>
    <section className="formalProgress"><div className="formalProgressTop"><small>ДВИЖЕНИЕ ДОКУМЕНТА</small><span>{progress}% процедуры</span></div><div className="formalProgressLine"><i style={{width:progress+'%'}}/></div><div className="formalSteps">{selected.workflow_steps.map((s,i)=><div key={s.code} className={i<selected.current_step?'formalStep done':i===selected.current_step?'formalStep current':'formalStep'}><span>{i<selected.current_step?'✓':i+1}</span><b>{s.label}</b><small>{ownerLabel(s.owner)}</small></div>)}</div></section>
    <section className="formalDocGrid"><article className="formalPaper"><div className="formalPaperInstitution">{selected.subject_label.toUpperCase()}</div><div className="formalPaperMeta"><span>{selected.registry_no}</span><span>{shortDate(selected.created_at)}</span></div><div className="formalPaperType">{typeLabel(selected.doc_type).toUpperCase()}</div><h1>{selected.title}</h1>{editing?<><input className="formalEditTitle" value={editTitle} onChange={e=>setEditTitle(e.target.value)}/><textarea className="formalEditBody" value={editBody} onChange={e=>setEditBody(e.target.value)}/><div className="formalEditActions"><button className="primary" disabled={busy} onClick={saveEdit}>Сохранить текст</button><button className="secondary" onClick={()=>setEditing(false)}>Отмена</button></div></>:<div className="formalPaperBody">{selected.body_text?<p>{selected.body_text}</p>:<p className="muted">Текст в системе не сохранён. Используйте прикреплённый оригинал.</p>}</div>}<div className="formalSignature"><div><span>{signature?.title}</span><b>{signature?.name}</b></div><div className="formalSignatureMark">ПОДПИСЬ</div></div><footer>Учебная система GOS//SIM · документ создан в рамках деловой игры</footer></article>
     <aside className="formalSidebar"><article className="surface formalPassport"><div className="surfaceHead"><div><small>ПАСПОРТ ДОКУМЕНТА</small><h2>Карточка</h2></div></div><dl><div><dt>Номер</dt><dd>{selected.registry_no}</dd></div><div><dt>Субъект</dt><dd>{selected.subject_label}</dd></div><div><dt>Автор</dt><dd>{author?.full_name||'—'}</dd></div><div><dt>Создан</dt><dd>{fmtDateTime(selected.created_at)}</dd></div><div><dt>Ответственный сейчас</dt><dd>{ownerLabel(selected.current_owner_key)}</dd></div></dl>{selected.file_url&&<a className="formalSourceFile" href={selected.file_url} target="_blank" rel="noreferrer">Открыть исходный файл ↗<small>{selected.source_file_name}</small></a>}{selected.author_id===me?.user_id&&selected.current_owner_key==='author'&&!editing&&<button className="secondary formalEditBtn" onClick={()=>startEdit(selected)}>Редактировать черновик</button>}</article>
      <article className="surface formalActions"><div className="surfaceHead"><div><small>ПРОЦЕДУРА</small><h2>Доступное действие</h2></div></div>{currentAction?<><p>Сейчас документ находится у: <b>{ownerLabel(selected.current_owner_key)}</b>.</p>{canManage(selected)?<><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await advanceFormalDocument(selected.id,'advance');setBusy(false)}}>{currentAction} →</button>{selected.current_owner_key!=='author'&&<div className="formalSecondaryActions"><button onClick={()=>void advanceFormalDocument(selected.id,'return','Возвращено на доработку')}>↺ Вернуть автору</button><button onClick={()=>{if(confirm('Отклонить документ?'))void advanceFormalDocument(selected.id,'reject','Документ отклонён')}}>× Отклонить</button></div>}</>:<div className="formalWaiting">Ожидается действие другого института. Все участники видят изменение стадии автоматически.</div>}</>:<div className="formalWaiting done">Процедура завершена.</div>}</article>
      <article className="surface formalHistory"><div className="surfaceHead"><div><small>ИСТОРИЯ</small><h2>Движение документа</h2></div></div><div>{history.length?history.map(h=><div className="formalHistoryRow" key={h.id}><span/><div><time>{fmtDateTime(h.created_at)}</time><b>{h.action}</b><small>{h.actor_id?members.find(m=>m.user_id===h.actor_id)?.full_name||'Участник':'Система'}{h.note?' · '+h.note:''}</small></div></div>):<div className="emptyState">История пока пуста.</div>}</div></article></aside>
    </section>
   </>}</main>
  </section>}

  <section className="formalLawBase"><div><small>ПРАВОВЫЕ ОРИЕНТИРЫ</small><h2>Как устроена процедура</h2></div><div className="formalLawLinks"><a href="https://www.consultant.ru/document/cons_doc_LAW_28399/" target="_blank" rel="noreferrer"><b>Конституция РФ</b><span>ст. 104–107 · законодательная инициатива и принятие законов ↗</span></a><a href="https://sozd.duma.gov.ru/" target="_blank" rel="noreferrer"><b>СОЗД Государственной Думы</b><span>образцы и реальное движение законопроектов ↗</span></a><a href="https://publication.pravo.gov.ru/" target="_blank" rel="noreferrer"><b>Официальное опубликование</b><span>официальные тексты принятых актов ↗</span></a></div></section>
 </div>;
}