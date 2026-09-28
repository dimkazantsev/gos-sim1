'use client';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import type {FormalDocument} from './types';
import {FORMAL_SUBJECTS,FORMAL_TYPES,inferFormal,formalSignature,ownerLabel} from './formalInstitutions';
import {votePresetForDocument} from './proceduralVoting';

function typeLabel(key:string){return FORMAL_TYPES.find(x=>x.key===key)?.label||key}
function shortDate(v:string){return new Date(v).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})}
function fmtDateTime(v:string){return new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function statusTone(code:string){if(['published','signed','adopted'].includes(code))return 'ok';if(['rejected','revision'].includes(code))return 'bad';if(code==='draft')return 'draft';return 'progress'}
type BillProfile={document_id:string;requires_financial_justification:boolean;requires_government_opinion:boolean;committee_key:string|null;representative_user_id:string|null;note:string|null};
type BillFile={id:string;document_id:string;file_kind:string;title:string;storage_path:string;file_name:string;status:'submitted'|'accepted'|'revision';note:string|null;url?:string|null};
type BillConclusion={document_id:string;rapporteur_user_id:string|null;legal_compliance:string;internal_logic:string;affected_acts_completeness:string;recommendation:'draft'|'proceed'|'return'|'reject';finalized:boolean};
type BillReadiness={submission_ready:boolean;committee_ready:boolean;issues:string[];review_issues:string[];required_files:string[];committee_key:string|null;committee_recommendation:string|null;committee_finalized:boolean};
type BudgetPreliminaryReview={document_id:string;documents_compliant:boolean;sent_to_all_committees:boolean;accounts_chamber_reviewed:boolean;committee_conclusion:string;decision:'draft'|'accept'|'return';note:string|null;updated_at:string};
const billFileLabels:Record<string,string>={explanatory_note:'Пояснительная записка',affected_acts:'Перечень затрагиваемых актов',financial_economic:'Финансово-экономическое обоснование',government_opinion:'Заключение Правительства РФ',collegial_decision:'Решение коллегиального субъекта о внесении',other_review:'Отзыв иного субъекта законодательной инициативы'};

export default function DocumentsView({g,focusId,onOpenVotes,readOnly=false}:{g:ReturnTypeRepublic;focusId?:string;onOpenVotes:()=>void;readOnly?:boolean}){
 const {formalDocuments,formalHistory,votes,members,me,teacher,currentStage,createFormalDocument,advanceFormalDocument,updateFormalDraft,vetoFormalDocument,resolveBudgetConciliation,startBudgetRejectionBranch,createVote}=g;
 const [mode,setMode]=useState<'registry'|'create'>('registry'),[selectedId,setSelectedId]=useState(''),[query,setQuery]=useState(''),[filterSubject,setFilterSubject]=useState(''),[filterStatus,setFilterStatus]=useState('');
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[subjectKey,setSubjectKey]=useState('gd_deputy'),[docType,setDocType]=useState('fz_bill'),[file,setFile]=useState<File|null>(null),[extracting,setExtracting]=useState(false),[recognized,setRecognized]=useState(''),[busy,setBusy]=useState(false);
 const [editing,setEditing]=useState(false),[editTitle,setEditTitle]=useState(''),[editBody,setEditBody]=useState('');
 const [billProfile,setBillProfile]=useState<BillProfile|null>(null),[billFiles,setBillFiles]=useState<BillFile[]>([]),[billConclusion,setBillConclusion]=useState<BillConclusion|null>(null),[billReadiness,setBillReadiness]=useState<BillReadiness|null>(null);
 const [billFinancial,setBillFinancial]=useState(false),[billGovernmentOpinion,setBillGovernmentOpinion]=useState(false),[billCommittee,setBillCommittee]=useState(''),[billRepresentative,setBillRepresentative]=useState(''),[billNote,setBillNote]=useState('');
 const [billFileKind,setBillFileKind]=useState('explanatory_note'),[billFile,setBillFile]=useState<File|null>(null),[billReviewNote,setBillReviewNote]=useState<Record<string,string>>({});
 const [committeeRapporteur,setCommitteeRapporteur]=useState(''),[committeeLegal,setCommitteeLegal]=useState(''),[committeeLogic,setCommitteeLogic]=useState(''),[committeeActs,setCommitteeActs]=useState(''),[committeeRecommendation,setCommitteeRecommendation]=useState<'draft'|'proceed'|'return'|'reject'>('draft');
 const [budgetReview,setBudgetReview]=useState<BudgetPreliminaryReview|null>(null),[budgetDocsOk,setBudgetDocsOk]=useState(false),[budgetDistributed,setBudgetDistributed]=useState(false),[budgetAccounts,setBudgetAccounts]=useState(false),[budgetConclusion,setBudgetConclusion]=useState(''),[budgetDecision,setBudgetDecision]=useState<'draft'|'accept'|'return'>('draft'),[budgetReviewNote,setBudgetReviewNote]=useState('');
 const [localRefresh,setLocalRefresh]=useState(0);

 const role=(me?.role_title||'').toLowerCase();
 const availableSubjects=useMemo(()=>teacher?FORMAL_SUBJECTS:FORMAL_SUBJECTS.filter(s=>s.roleHints.some(h=>role.includes(h))),[teacher,role]);
 const selected=useMemo(()=>formalDocuments.find(d=>d.id===selectedId)||formalDocuments[0],[formalDocuments,selectedId]);
 const [committeeUnits,setCommitteeUnits]=useState<{unit_key:string;title:string;head_user_id:string|null}[]>([]);
 useEffect(()=>{if(!me||!g.game)return;void supabase.from('institution_units').select('unit_key,title,head_user_id').eq('game_id',g.game.id).eq('unit_kind','committee').then(r=>{if(!r.error)setCommitteeUnits((r.data||[]) as any)})},[me?.user_id,g.game?.id]);
 useEffect(()=>{if(focusId&&formalDocuments.some(d=>d.id===focusId))setSelectedId(focusId)},[focusId,formalDocuments]);
 useEffect(()=>{
  if(!selected||selected.workflow_key!=='bill'){setBillProfile(null);setBillFiles([]);setBillConclusion(null);setBillReadiness(null);return}
  void (async()=>{
   const [p,f,cc,r]=await Promise.all([
    supabase.from('bill_submission_profiles').select('*').eq('document_id',selected.id).maybeSingle(),
    supabase.from('bill_package_files').select('*').eq('document_id',selected.id).order('created_at'),
    supabase.from('bill_committee_conclusions').select('*').eq('document_id',selected.id).maybeSingle(),
    supabase.rpc('get_bill_dossier_readiness',{p_document_id:selected.id})
   ]);
   const bp=(p.data||null) as BillProfile|null;setBillProfile(bp);
   setBillFinancial(!!bp?.requires_financial_justification);setBillGovernmentOpinion(!!bp?.requires_government_opinion);setBillCommittee(bp?.committee_key||'');setBillRepresentative(bp?.representative_user_id||'');setBillNote(bp?.note||'');
   if(!f.error){
    const rows=(f.data||[]) as BillFile[];
    const withUrls=await Promise.all(rows.map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
    setBillFiles(withUrls);
   }
   const bc=(cc.data||null) as BillConclusion|null;setBillConclusion(bc);
   setCommitteeRapporteur(bc?.rapporteur_user_id||'');setCommitteeLegal(bc?.legal_compliance||'');setCommitteeLogic(bc?.internal_logic||'');setCommitteeActs(bc?.affected_acts_completeness||'');setCommitteeRecommendation(bc?.recommendation||'draft');
   if(!r.error)setBillReadiness(r.data as BillReadiness);
  })();
 },[selected?.id,selected?.updated_at,localRefresh]);
 useEffect(()=>{
  if(!selected||selected.workflow_key!=='budget'){setBudgetReview(null);return}
  void supabase.from('budget_preliminary_reviews').select('*').eq('document_id',selected.id).maybeSingle().then(r=>{
   if(r.error)return;
   const x=(r.data||null) as BudgetPreliminaryReview|null;setBudgetReview(x);
   setBudgetDocsOk(!!x?.documents_compliant);setBudgetDistributed(!!x?.sent_to_all_committees);setBudgetAccounts(!!x?.accounts_chamber_reviewed);
   setBudgetConclusion(x?.committee_conclusion||'');setBudgetDecision(x?.decision||'draft');setBudgetReviewNote(x?.note||'');
  });
 },[selected?.id,selected?.updated_at,localRefresh]);
 const filtered=useMemo(()=>formalDocuments.filter(d=>{const q=query.trim().toLowerCase();return(!q||[d.registry_no,d.title,d.subject_label,typeLabel(d.doc_type),d.status_label].join(' ').toLowerCase().includes(q))&&(!filterSubject||d.subject_key===filterSubject)&&(!filterStatus||d.status_code===filterStatus)}),[formalDocuments,query,filterSubject,filterStatus]);
 const history=selected?formalHistory.filter(h=>h.document_id===selected.id).slice().reverse():[];
 const author=selected?members.find(m=>m.user_id===selected.author_id):undefined;
 const subject=selected?FORMAL_SUBJECTS.find(s=>s.key===selected.subject_key):undefined;
 const personalSigner=selected&&['gd_deputy','sf_member','region','ks','vs'].includes(selected.subject_key);
 const signatureHolder=selected?(personalSigner?author:(members.find(m=>subject?.roleHints.some(h=>(m.role_title||'').toLowerCase().includes(h)))||author)):undefined;
 const signature=selected?formalSignature(selected.subject_key,signatureHolder?.full_name||author?.full_name||'________________'):null;

 function canManage(doc:FormalDocument){
  if(readOnly)return false;if(teacher)return true;if(!me)return false;if(doc.current_owner_key==='author')return doc.author_id===me.user_id;
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
   const baseTitle=title||next.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ');if(!title)setTitle(baseTitle);
   const extracted=typeof data.text==='string'?data.text:'';
   if(extracted)setBody(extracted);
   const found=inferFormal(extracted,baseTitle,me?.role_title);
   if(teacher||availableSubjects.some(s=>s.key===found.subject.key))setSubjectKey(found.subject.key);else if(availableSubjects[0])setSubjectKey(availableSubjects[0].key);
   setDocType(found.type.key);
   setRecognized(extracted?('✓ Текст извлечён'+(data.pages?' · '+data.pages+' стр.':'')+' · '+found.type.label+' · '+found.subject.short):('✓ Файл прикреплён · предварительно: '+found.type.label+' · '+found.subject.short+'. Вставьте текст ниже для точного распознавания.'));
  }catch(e){setRecognized(e instanceof Error?e.message:'Ошибка распознавания')}finally{setExtracting(false)}
 }

 function chooseSubject(key:string){setSubjectKey(key);const s=FORMAL_SUBJECTS.find(x=>x.key===key);if(s){const current=FORMAL_TYPES.find(x=>x.key===docType);if(!current||current.workflow==='generic'||current.key==='other')setDocType(s.defaultType)}}

 async function create(){
  const s=FORMAL_SUBJECTS.find(x=>x.key===subjectKey),t=FORMAL_TYPES.find(x=>x.key===docType);if(!s||!t||title.trim().length<3)return;
  const personalSigner=['gd_deputy','sf_member','region','ks','vs'].includes(s.key);
  const holder=personalSigner?me:(members.find(m=>s.roleHints.some(h=>(m.role_title||'').toLowerCase().includes(h)))||me);const signatureMeta=formalSignature(s.key,holder?.full_name||me?.full_name||'');
  setBusy(true);
  const id=await createFormalDocument({stageNo:currentStage?.stage_no||12,title:title.trim(),docType:t.key,subjectKey:s.key,subjectLabel:s.label,bodyText:body,workflowKey:t.workflow,metadata:{signature_title:signatureMeta.title,signature_name:signatureMeta.name,institution:s.label,recognized:recognized||null,created_in_editor:!file}},file||undefined);
  setBusy(false);if(id){setSelectedId(id);setMode('registry');setTitle('');setBody('');setFile(null);setRecognized('')}
 }

 function startEdit(doc:FormalDocument){setEditTitle(doc.title);setEditBody(doc.body_text||'');setEditing(true)}
 async function saveEdit(){if(!selected)return;setBusy(true);const ok=await updateFormalDraft(selected.id,editTitle,editBody,selected.metadata);setBusy(false);if(ok)setEditing(false)}

 const currentAction=selected?.workflow_steps[selected.current_step]?.action;
 const progress=selected?Math.round((selected.current_step/Math.max(1,selected.workflow_steps.length-1))*100):0;
 const votePreset=selected?votePresetForDocument(selected):null;
 const linkedOpenVote=selected?votes.find(v=>v.formal_document_id===selected.id&&v.status==='open'&&v.formal_step_code===selected.status_code):undefined;
 const lastStepVote=selected?[...votes].filter(v=>v.formal_document_id===selected.id&&v.formal_step_code===selected.status_code).sort((a,b)=>new Date(b.opened_at).getTime()-new Date(a.opened_at).getTime())[0]:undefined;
 const budgetReading1Rejected=!!selected&&selected.workflow_key==='budget'&&selected.status_code==='reading1'&&lastStepVote?.status==='closed'&&lastStepVote.result_code==='rejected';
 async function openProceduralVote(){
  if(!selected||!votePreset)return;
  const ok=await createVote({...votePreset,formalDocumentId:selected.id});
  if(ok)onOpenVotes();
 }
 async function saveBillProfile(){
  if(readOnly)return;
  if(!selected)return;setBusy(true);
  const r=await supabase.rpc('save_bill_submission_profile',{p_document_id:selected.id,p_requires_financial_justification:billFinancial,p_requires_government_opinion:billGovernmentOpinion,p_committee_key:billCommittee||null,p_representative_user_id:billRepresentative||null,p_note:billNote.trim()||null});
  if(r.error)g.setError(r.error.message);else setLocalRefresh(x=>x+1);setBusy(false);
 }
 async function uploadBillFile(){
  if(readOnly)return;
  if(!selected||!billFile)return;
  const ext=(billFile.name.split('.').pop()||'bin').toLowerCase();const storagePath=g.game!.id+'/formal/'+selected.id+'/package/'+crypto.randomUUID()+'.'+ext;
  setBusy(true);const up=await supabase.storage.from('game-assets').upload(storagePath,billFile,{contentType:billFile.type||'application/octet-stream'});
  if(up.error){g.setError(up.error.message);setBusy(false);return}
  const r=await supabase.rpc('add_bill_package_file',{p_document_id:selected.id,p_file_kind:billFileKind,p_title:billFileLabels[billFileKind]||billFile.name,p_storage_path:storagePath,p_file_name:billFile.name,p_mime_type:billFile.type||null,p_file_size:billFile.size});
  if(r.error)g.setError(r.error.message);else{setBillFile(null);setLocalRefresh(x=>x+1)}setBusy(false);
 }
 async function reviewBillFile(id:string,status:'accepted'|'revision'){
  if(readOnly)return;
  setBusy(true);const r=await supabase.rpc('review_bill_package_file',{p_file_id:id,p_status:status,p_note:(billReviewNote[id]||'').trim()||null});
  if(r.error)g.setError(r.error.message);else if(selected)setLocalRefresh(x=>x+1);setBusy(false);
 }
 async function saveCommitteeConclusion(finalize:boolean){
  if(readOnly)return;
  if(!selected)return;setBusy(true);const r=await supabase.rpc('save_bill_committee_conclusion',{p_document_id:selected.id,p_rapporteur_user_id:committeeRapporteur||null,p_legal_compliance:committeeLegal,p_internal_logic:committeeLogic,p_affected_acts_completeness:committeeActs,p_recommendation:committeeRecommendation,p_finalize:finalize});
  if(r.error)g.setError(r.error.message);else setLocalRefresh(x=>x+1);setBusy(false);
 }
 async function saveBudgetPreliminary(){
  if(readOnly)return;
  if(!selected)return;setBusy(true);
  const r=await supabase.rpc('save_budget_preliminary_review',{
   p_document_id:selected.id,p_documents_compliant:budgetDocsOk,p_sent_to_all_committees:budgetDistributed,
   p_accounts_chamber_reviewed:budgetAccounts,p_committee_conclusion:budgetConclusion,p_decision:budgetDecision,p_note:budgetReviewNote.trim()||null
  });
  if(r.error)g.setError(r.error.message);else setLocalRefresh(x=>x+1);
  setBusy(false);
 }

 return <div className="formalPage">
  <section className="formalHero"><div><small>ФОРМАЛЬНЫЕ ИНСТИТУТЫ · НПА</small><h1>Система нормативной деятельности государства</h1><p>Учебный реестр актов: создание, регистрация, рассмотрение, чтения, одобрение, подписание и опубликование. Движение каждого документа видно всем участникам.</p></div><div className="formalHeroActions"><a href="https://sozd.duma.gov.ru/" target="_blank" rel="noreferrer">СОЗД ГД ↗</a><a href="https://publication.pravo.gov.ru/" target="_blank" rel="noreferrer">Официальное опубликование ↗</a><button className="primary" onClick={()=>setMode('create')}>＋ Создать документ</button></div></section>

  <section className="formalStats"><article><small>ВСЕГО В РЕЕСТРЕ</small><strong>{formalDocuments.length}</strong><span>документов</span></article><article><small>В ПРОЦЕССЕ</small><strong>{formalDocuments.filter(d=>!['published','rejected'].includes(d.status_code)).length}</strong><span>движутся по процедуре</span></article><article><small>ЗАВЕРШЕНО</small><strong>{formalDocuments.filter(d=>['published','signed','adopted'].includes(d.status_code)).length}</strong><span>принятых актов</span></article><article><small>МОИ ДОКУМЕНТЫ</small><strong>{formalDocuments.filter(d=>d.author_id===me?.user_id).length}</strong><span>инициировано вами</span></article></section>

  <div className="formalTabs"><button className={mode==='registry'?'active':''} onClick={()=>setMode('registry')}>Реестр НПА</button><button className={mode==='create'?'active':''} onClick={()=>setMode('create')}>Создать / загрузить</button></div>

  {mode==='create'&&<section className="formalCreate"><aside className="formalCreateGuide"><small>НОВЫЙ ДОКУМЕНТ</small><h2>Создайте внутри или загрузите готовый</h2><p>Система извлечёт текст из PDF/DOCX/TXT, попробует определить вид акта и субъект, а затем построит правильный маршрут движения.</p><ol><li><b>1</b><span>Вставьте текст или загрузите файл</span></li><li><b>2</b><span>Проверьте вид акта и субъект</span></li><li><b>3</b><span>Зарегистрируйте документ</span></li></ol><div className="formalRoleHint"><small>ВАША ИГРОВАЯ РОЛЬ</small><b>{me?.role_title||'Не назначена'}</b><p>{teacher?'Преподаватель может создавать документы от любого института.':availableSubjects.length?'Доступные субъекты: '+availableSubjects.map(x=>x.short).join(', '):'Для вашей роли пока не определён субъект нормативной деятельности.'}</p></div></aside>
   <div className="formalCreateForm"><div className="formalInputBlock"><label>Название документа</label><input aria-label="Название документа" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Например: О внесении изменений в Федеральный закон…"/></div><div className="formalFileDrop"><input aria-label="Загрузить документ для распознавания" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={e=>{const x=e.target.files?.[0];if(x)void extractFile(x)}}/><div><span>⇧</span><b>{file?file.name:'Загрузить PDF, DOCX или TXT'}</b><small>{extracting?'Извлекаю текст…':'Можно также просто вставить текст ниже'}</small></div></div><div className="formalEditorHead"><label>Текст документа</label><button onClick={()=>applyInference()}>◇ Распознать ещё раз</button></div><textarea aria-label="Текст документа" className="formalTextEditor" value={body} onChange={e=>setBody(e.target.value)} placeholder="Вставьте полный текст документа…"/>{recognized&&<div className="recognitionResult">{recognized}</div>}<div className="formalRecognitionGrid"><label>Субъект<select value={subjectKey} onChange={e=>chooseSubject(e.target.value)}>{(teacher?FORMAL_SUBJECTS:availableSubjects).map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label><label>Вид документа<select value={docType} onChange={e=>setDocType(e.target.value)}>{FORMAL_TYPES.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label></div><div className="formalCreateFooter"><span>Этап игры: {currentStage?.stage_no||'—'} · {currentStage?.title}</span><button className="primary" disabled={busy||title.trim().length<3||(!teacher&&!availableSubjects.length)} onClick={create}>{busy?'Регистрирую…':'Зарегистрировать в системе →'}</button></div></div>
  </section>}

  {mode==='registry'&&<section className="formalWorkspace"><aside className="formalRegistry"><div className="formalRegistryHead"><div><small>РЕЕСТР</small><h2>Нормативные документы</h2></div><button aria-label="Создать документ" onClick={()=>setMode('create')}>＋</button></div><input aria-label="Поиск в реестре НПА" className="formalSearch" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск по номеру, названию, субъекту…"/><div className="formalFilters"><select aria-label="Фильтр по субъекту" value={filterSubject} onChange={e=>setFilterSubject(e.target.value)}><option value="">Все субъекты</option>{FORMAL_SUBJECTS.map(s=><option key={s.key} value={s.key}>{s.short}</option>)}</select><select aria-label="Фильтр по стадии документа" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="">Все стадии</option><option value="draft">Черновик</option><option value="registered">Регистрация</option><option value="committee">Комитет</option><option value="reading1">I чтение</option><option value="reading2">II чтение</option><option value="reading3">III чтение</option><option value="president">Президент</option><option value="published">Опубликован</option><option value="rejected">Отклонён</option></select></div><div className="formalRegistryList">{filtered.length?filtered.map(d=><button key={d.id} className={selected?.id===d.id?'formalRegistryRow active':'formalRegistryRow'} onClick={()=>setSelectedId(d.id)}><div className="formalRegistryNo">{d.registry_no}</div><b>{d.title}</b><span>{d.subject_label}</span><div><em className={`formalStatus ${statusTone(d.status_code)}`}>{d.status_label}</em><time>{shortDate(d.updated_at)}</time></div></button>):<div className="emptyState">По этому фильтру документов нет.</div>}</div></aside>

   <article className="formalDetail">{!selected?<div className="formalEmptyBig"><span>▤</span><h2>Реестр пока пуст</h2><p>Создайте первый нормативный документ — он появится здесь и начнёт движение по процедуре.</p><button className="primary" onClick={()=>setMode('create')}>Создать документ</button></div>:<>
    <header className="formalDocHeader"><div><small>{selected.registry_no} · ЭТАП {selected.stage_no}</small><h2>{selected.title}</h2><p>{typeLabel(selected.doc_type)} · {selected.subject_label}</p></div><div className={`formalStatusLarge ${statusTone(selected.status_code)}`}><small>ТЕКУЩАЯ СТАДИЯ</small><b>{selected.status_label}</b><span>{ownerLabel(selected.current_owner_key)}</span></div></header>
    <section className="formalProgress"><div className="formalProgressTop"><small>ДВИЖЕНИЕ ДОКУМЕНТА</small><span>{progress}% процедуры</span></div><div className="formalProgressLine"><i style={{width:progress+'%'}}/></div><div className="formalSteps">{selected.workflow_steps.map((s,i)=><div key={s.code} className={i<selected.current_step?'formalStep done':i===selected.current_step?'formalStep current':'formalStep'}><span>{i<selected.current_step?'✓':i+1}</span><b>{s.label}</b><small>{ownerLabel(s.owner)}</small></div>)}</div></section>
    <section className="formalDocGrid"><article className="formalPaper"><div className="formalPaperInstitution">{selected.subject_label.toUpperCase()}</div><div className="formalPaperMeta"><span>{selected.registry_no}</span><span>{shortDate(selected.created_at)}</span></div><div className="formalPaperType">{typeLabel(selected.doc_type).toUpperCase()}</div><h1>{selected.title}</h1>{editing?<><input className="formalEditTitle" value={editTitle} onChange={e=>setEditTitle(e.target.value)}/><textarea className="formalEditBody" value={editBody} onChange={e=>setEditBody(e.target.value)}/><div className="formalEditActions"><button className="primary" disabled={busy} onClick={saveEdit}>Сохранить текст</button><button className="secondary" onClick={()=>setEditing(false)}>Отмена</button></div></>:<div className="formalPaperBody">{selected.body_text?<p>{selected.body_text}</p>:<p className="muted">Текст в системе не сохранён. Используйте прикреплённый оригинал.</p>}</div>}<div className="formalSignature"><div><span>{signature?.title}</span><b>{signature?.name}</b></div><div className="formalSignatureMark">ПОДПИСЬ</div></div><footer>Учебная система GOS//SIM · документ создан в рамках деловой игры</footer></article>
     <aside className="formalSidebar"><article className="surface formalPassport"><div className="surfaceHead"><div><small>ПАСПОРТ ДОКУМЕНТА</small><h2>Карточка</h2></div></div><dl><div><dt>Номер</dt><dd>{selected.registry_no}</dd></div><div><dt>Субъект</dt><dd>{selected.subject_label}</dd></div><div><dt>Автор</dt><dd>{author?.full_name||'—'}</dd></div><div><dt>Создан</dt><dd>{fmtDateTime(selected.created_at)}</dd></div><div><dt>Ответственный сейчас</dt><dd>{ownerLabel(selected.current_owner_key)}</dd></div></dl>{selected.file_url&&<a className="formalSourceFile" href={selected.file_url} target="_blank" rel="noreferrer">Открыть исходный файл ↗<small>{selected.source_file_name}</small></a>}{selected.author_id===me?.user_id&&selected.current_owner_key==='author'&&!editing&&<button className="secondary formalEditBtn" onClick={()=>startEdit(selected)}>Редактировать черновик</button>}</article>
      {selected.workflow_key==='bill'&&<article className="surface billDossier"><div className="surfaceHead"><div><small>ПАКЕТ ВНЕСЕНИЯ · ЭТАП 12</small><h2>Досье законопроекта</h2></div><span className={billReadiness?.committee_ready?'ok':billReadiness?.submission_ready?'warn':'bad'}>{billReadiness?.committee_ready?'Готово':billReadiness?.submission_ready?'Пакет готов':'Не готово'}</span></div>
       <div className="billProfileForm">
        <label><input type="checkbox" checked={billFinancial} onChange={e=>setBillFinancial(e.target.checked)}/> Требуется ФЭО</label>
        <label><input type="checkbox" checked={billGovernmentOpinion} onChange={e=>setBillGovernmentOpinion(e.target.checked)}/> Требуется заключение Правительства</label>
        <label>Профильный комитет<select value={billCommittee} onChange={e=>setBillCommittee(e.target.value)}><option value="">Не выбран</option>{committeeUnits.map(x=><option key={x.unit_key} value={x.unit_key}>{x.title}</option>)}</select></label>
        <label>Представитель в ГД<select value={billRepresentative} onChange={e=>setBillRepresentative(e.target.value)}><option value="">Не указан</option>{members.filter(m=>m.kind==='student').map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>
        <textarea rows={2} value={billNote} onChange={e=>setBillNote(e.target.value)} placeholder="Комментарий к внесению"/>
        {(selected.author_id===me?.user_id||teacher||selected.current_owner_key==='gd_staff'||selected.current_owner_key==='gd_council')&&<button className="secondary" disabled={busy} onClick={()=>void saveBillProfile()}>Сохранить карточку внесения</button>}
       </div>
       <div className="billPackageList">{(billReadiness?.required_files||['explanatory_note','affected_acts']).map(kind=>{const bf=billFiles.find(x=>x.file_kind===kind);return <div key={kind} className={bf?.status||'missing'}><span>{bf?.status==='accepted'?'✓':bf?.status==='revision'?'↺':bf?'○':'—'}</span><div><b>{billFileLabels[kind]||kind}</b>{bf&&<a href={bf.url||'#'} target="_blank" rel="noreferrer">{bf.file_name}</a>}{bf?.note&&<small>{bf.note}</small>}</div>{bf&&canManage(selected)&&<div><input value={billReviewNote[bf.id]||''} onChange={e=>setBillReviewNote(v=>({...v,[bf.id]:e.target.value}))} placeholder="Комментарий"/><button onClick={()=>void reviewBillFile(bf.id,'accepted')}>Принять</button><button onClick={()=>void reviewBillFile(bf.id,'revision')}>Доработка</button></div>}</div>})}</div>
       {selected.author_id===me?.user_id&&selected.current_owner_key==='author'&&<div className="billPackageUpload"><select aria-label="Вид приложения к законопроекту" value={billFileKind} onChange={e=>setBillFileKind(e.target.value)}>{Object.entries(billFileLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><label>Файл<input type="file" accept=".pdf,.doc,.docx,.txt" onChange={e=>setBillFile(e.target.files?.[0]||null)}/></label><button disabled={busy||!billFile} onClick={()=>void uploadBillFile()}>Загрузить</button></div>}
       {(selected.status_code==='committee'||billConclusion)&&<div className="billCommitteeConclusion"><small>ЗАКЛЮЧЕНИЕ ПРОФИЛЬНОГО КОМИТЕТА</small><label>Докладчик<select value={committeeRapporteur} onChange={e=>setCommitteeRapporteur(e.target.value)}><option value="">Не выбран</option>{members.filter(m=>m.kind==='student').map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label><label>Соответствие Конституции, ФКЗ и ФЗ<textarea rows={3} value={committeeLegal} onChange={e=>setCommitteeLegal(e.target.value)}/></label><label>Внутренняя логика и противоречия<textarea rows={3} value={committeeLogic} onChange={e=>setCommitteeLogic(e.target.value)}/></label><label>Полнота перечня изменяемых актов<textarea rows={3} value={committeeActs} onChange={e=>setCommitteeActs(e.target.value)}/></label><label>Рекомендация<select value={committeeRecommendation} onChange={e=>setCommitteeRecommendation(e.target.value as any)}><option value="draft">Черновик</option><option value="proceed">Передать в Совет ГД</option><option value="return">Вернуть субъекту инициативы</option><option value="reject">Рекомендовать отклонить</option></select></label>{canManage(selected)&&<div><button className="secondary" disabled={busy} onClick={()=>void saveCommitteeConclusion(false)}>Сохранить</button><button className="primary" disabled={busy||committeeRecommendation==='draft'} onClick={()=>void saveCommitteeConclusion(true)}>Зафиксировать заключение</button></div>}</div>}
       {billReadiness&&(!billReadiness.submission_ready||!billReadiness.committee_ready)&&<div className="billDossierIssues">{[...billReadiness.issues,...billReadiness.review_issues].map(x=><p key={x}>• {x}</p>)}</div>}
      </article>}
      {selected.workflow_key==='budget'&&['budget_registered','budget_committee','budget_council','revision'].includes(selected.status_code)&&<article className="surface budgetPreliminary"><div className="surfaceHead"><div><small>СТ. 192 БК РФ · ЭТАП 13</small><h2>Предварительная проверка бюджета</h2></div><span className={budgetReview?.decision==='accept'?'ok':budgetReview?.decision==='return'?'bad':'warn'}>{budgetReview?.decision==='accept'?'Принят к рассмотрению':budgetReview?.decision==='return'?'Возврат':'Проверка'}</span></div>
       <p className="budgetPreliminaryIntro">До I чтения Комитет по бюджету проверяет комплектность проекта. После принятия к рассмотрению проект и материалы направляются комитетам ГД и Счётной палате.</p>
       <div className="budgetPreliminaryChecks"><label><input type="checkbox" checked={budgetDocsOk} onChange={e=>setBudgetDocsOk(e.target.checked)}/> Документы и материалы соответствуют требованиям</label><label><input type="checkbox" checked={budgetDistributed} onChange={e=>setBudgetDistributed(e.target.checked)}/> Проект направлен во все комитеты ГД</label><label><input type="checkbox" checked={budgetAccounts} onChange={e=>setBudgetAccounts(e.target.checked)}/> Получено/смоделировано заключение Счётной палаты</label></div>
       <label className="budgetPreliminaryText">Заключение Комитета по бюджету<textarea rows={4} value={budgetConclusion} onChange={e=>setBudgetConclusion(e.target.value)} placeholder="Оцените соответствие комплекта требованиям, полноту материалов и готовность проекта к рассмотрению Государственной Думой."/></label>
       <label className="budgetPreliminaryText">Примечание<textarea rows={2} value={budgetReviewNote} onChange={e=>setBudgetReviewNote(e.target.value)} placeholder="Замечания, условия возврата или организационные сведения"/></label>
       <div className="budgetPreliminaryDecision"><select aria-label="Решение по предварительной проверке бюджета" value={budgetDecision} onChange={e=>setBudgetDecision(e.target.value as 'draft'|'accept'|'return')}><option value="draft">Черновик решения</option><option value="accept">Принять к рассмотрению</option><option value="return">Вернуть Правительству</option></select><button className="primary" disabled={busy} onClick={()=>void saveBudgetPreliminary()}>Зафиксировать проверку</button></div>
      </article>}
      <article className="surface formalActions"><div className="surfaceHead"><div><small>ПРОЦЕДУРА</small><h2>Доступное действие</h2></div></div>
       <p>Сейчас документ находится у: <b>{ownerLabel(selected.current_owner_key)}</b>.</p>
       {linkedOpenVote?<div className="formalVoteLink active"><small>● ИДЁТ ГОЛОСОВАНИЕ</small><b>{linkedOpenVote.title}</b><span>Результат автоматически изменит стадию документа.</span><button className="primary" onClick={onOpenVotes}>Открыть голосование →</button></div>
       :selected.status_code==='budget_conciliation'?<div className="formalBranchPanel"><small>СОГЛАСИТЕЛЬНАЯ КОМИССИЯ</small><b>Президент отклонил закон о федеральном бюджете</b><p>В соответствии с правилами игры необходимо выработать согласованный вариант либо вернуть проект Правительству на доработку.</p>{canManage(selected)||teacher?<div><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await resolveBudgetConciliation(selected.id,'agreed','Согласованный вариант выработан');setBusy(false)}}>✓ Согласованный вариант готов</button><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);await resolveBudgetConciliation(selected.id,'government_revision','Возвращено Правительству');setBusy(false)}}>↺ Вернуть Правительству</button></div>:<span>Ожидается решение согласительной комиссии.</span>}</div>
       :selected.status_code==='president'&&canManage(selected)?<div className="presidentialDecision"><small>РЕШЕНИЕ ПРЕЗИДЕНТА РФ</small><b>{selected.workflow_key==='budget'?'Федеральный бюджет поступил Президенту':'Закон поступил на промульгацию'}</b><p>{selected.workflow_key==='budget'?'Президент может подписать закон о бюджете либо отклонить его; при отклонении запускается согласительная процедура.':'Президент может подписать федеральный закон либо отклонить его. При вето Государственная Дума сможет поставить вопрос о преодолении вето.'}</p><div><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await advanceFormalDocument(selected.id,'advance','Подписано Президентом Российской Федерации');setBusy(false)}}>Подписать →</button><button className="vetoButton" disabled={busy} onClick={async()=>{if(!confirm('Отклонить документ Президентом Российской Федерации?'))return;setBusy(true);await vetoFormalDocument(selected.id,'Отклонено Президентом Российской Федерации');setBusy(false)}}>Наложить вето</button></div></div>
       :budgetReading1Rejected&&canManage(selected)?<div className="formalBranchPanel warning"><small>БЮДЖЕТ ОТКЛОНЁН В I ЧТЕНИИ</small><b>Выберите дальнейшую процедуру</b><p>Правила допускают согласительную комиссию, возврат проекта Правительству на доработку либо постановку вопроса о доверии Правительству.</p><div><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await startBudgetRejectionBranch(selected.id,'conciliation','После отклонения в I чтении');setBusy(false)}}>Согласительная комиссия</button><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);await startBudgetRejectionBranch(selected.id,'government_revision','Возврат бюджета Правительству после I чтения');setBusy(false)}}>Вернуть Правительству</button><button className="secondary" onClick={onOpenVotes}>Вопрос о доверии →</button></div></div>
       :votePreset&&canManage(selected)?<div className={'formalVoteLink legal-'+votePreset.legalMode}><small>{votePreset.badge}</small><b>Требуется решение голосованием</b><span>{votePreset.rule}</span><p className="formalLegalBasis"><i>{votePreset.legalMode==='law'?'Действующее право':votePreset.legalMode==='reduction'?'Право + учебная редукция':'Правило игры'}</i>{votePreset.legalBasis}</p><button className="primary" disabled={busy} onClick={openProceduralVote}>Открыть голосование →</button></div>
       :currentAction?canManage(selected)?<><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await advanceFormalDocument(selected.id,'advance');setBusy(false)}}>{currentAction} →</button>{selected.current_owner_key!=='author'&&<div className="formalSecondaryActions"><button onClick={()=>void advanceFormalDocument(selected.id,'return','Возвращено на доработку')}>↺ Вернуть автору</button><button onClick={()=>{if(confirm('Отклонить документ?'))void advanceFormalDocument(selected.id,'reject','Документ отклонён')}}>× Отклонить</button></div>}</>:<div className="formalWaiting">Ожидается действие другого института. Все участники видят изменение стадии автоматически.</div>
       :<div className="formalWaiting done">Процедура завершена.</div>}</article>
      <article className="surface formalHistory"><div className="surfaceHead"><div><small>ИСТОРИЯ</small><h2>Движение документа</h2></div></div><div>{history.length?history.map(h=><div className="formalHistoryRow" key={h.id}><span/><div><time>{fmtDateTime(h.created_at)}</time><b>{h.action}</b><small>{h.actor_id?members.find(m=>m.user_id===h.actor_id)?.full_name||'Участник':'Система'}{h.note?' · '+h.note:''}</small></div></div>):<div className="emptyState">История пока пуста.</div>}</div></article></aside>
    </section>
   </>}</article>
  </section>}

  <section className="formalLawBase"><div><small>ПРАВОВЫЕ ОРИЕНТИРЫ</small><h2>Как устроена процедура</h2></div><div className="formalLawLinks"><a href="https://www.consultant.ru/document/cons_doc_LAW_28399/" target="_blank" rel="noreferrer"><b>Конституция РФ</b><span>ст. 104–107 · законодательная инициатива и принятие законов ↗</span></a><a href="https://sozd.duma.gov.ru/" target="_blank" rel="noreferrer"><b>СОЗД Государственной Думы</b><span>образцы и реальное движение законопроектов ↗</span></a><a href="https://publication.pravo.gov.ru/" target="_blank" rel="noreferrer"><b>Официальное опубликование</b><span>официальные тексты принятых актов ↗</span></a></div></section>
 </div>;
}