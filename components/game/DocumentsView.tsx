'use client';
import {userError} from '@/lib/userError';
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import type {FormalDocument} from './types';
import {FORMAL_SUBJECTS,FORMAL_TYPES,inferFormal,formalSignature,ownerLabel} from './formalInstitutions';
import {votePresetForDocument} from './proceduralVoting';
import {ArrowLeft,BookOpen,CheckCircle2,ChevronDown,CircleAlert,Clock3,ClipboardList,FilePlus2,Paperclip,Plus,Printer,Route,Search,Vote,X} from 'lucide-react';
import StyledSelect from '../ui/StyledSelect';
import DocumentPaper from './DocumentPaper';
import BudgetDocumentAnnex from './BudgetDocumentAnnex';
import {DOCUMENT_TEMPLATES} from './documentTemplates';
import {useSavedGameState,savedChoice,savedString,savedBoolean} from './useSavedGameState';
import {DocumentTools,DocumentInbox,type DocumentAccess} from './DocumentTools';
import CivicDiscussion from './CivicDiscussion';
import CloudDocumentPicker from './CloudDocumentPicker';

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
function readableBillIssue(issue:string){
 let text=issue;
 for(const [key,label] of Object.entries(billFileLabels))text=text.replaceAll(key,label);
 return text
  .replace('Не заполнена карточка внесения законопроекта','Не заполнена карточка внесения: выберите профильный комитет и сохраните карточку')
  .replace('Профильный комитет не завершил мотивированное заключение','Профильный комитет ещё не зафиксировал итоговое заключение');
}

export default function DocumentsView({g,focusId,createTemplate,createStageNo,onOpenVotes,onSelectDocument,onOpenBudget,readOnly=false,initialDetailTab='text'}:{g:ReturnTypeRepublic;initialDetailTab?:'text'|'procedure';focusId?:string;createTemplate?:string;createStageNo?:number;onOpenVotes:(voteId?:string)=>void;onSelectDocument?:(id?:string)=>void;onOpenBudget?:()=>void;readOnly?:boolean}){
 const {formalDocuments,formalHistory,votes,members,me,teacher,currentStage,createFormalDocument,advanceFormalDocument,updateFormalDraft,vetoFormalDocument,resolveBudgetConciliation,startBudgetRejectionBranch,createVote}=g;
 const [mode,setMode]=useSavedGameState<'registry'|'create'>(g.game?.id,g.me?.user_id,'documents-mode','registry',savedChoice('registry','create')),[selectedId,setSelectedId]=useSavedGameState(g.game?.id,g.me?.user_id,'documents-selected','',savedString),[query,setQuery]=useState(''),[filterSubject,setFilterSubject]=useState(''),[filterStatus,setFilterStatus]=useState(''),[sortOrder,setSortOrder]=useState('updated');
 const [detailOpen,setDetailOpen]=useSavedGameState(g.game?.id,g.me?.user_id,'documents-detail',!!focusId,savedBoolean),[detailTab,setDetailTab]=useSavedGameState<'text'|'procedure'|'package'>(g.game?.id,g.me?.user_id,'documents-tab',initialDetailTab,savedChoice('text','procedure','package'));
 const [detailReturn,setDetailReturn]=useState<'registry'|'create'>('registry');
 const [scrollOpenedDocument,setScrollOpenedDocument]=useState(false);
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[subjectKey,setSubjectKey]=useState('gd_deputy'),[docType,setDocType]=useState('fz_bill'),[file,setFile]=useState<File|null>(null),[extracting,setExtracting]=useState(false),[recognized,setRecognized]=useState(''),[busy,setBusy]=useState(false);
 const [templateKey,setTemplateKey]=useState('fz_bill'),[issuer,setIssuer]=useState(''),[place,setPlace]=useState('Москва');
 const [editing,setEditing]=useState(false),[editTitle,setEditTitle]=useState(''),[editBody,setEditBody]=useState('');
 const [documentAccess,setDocumentAccess]=useState<DocumentAccess|null>(null),[accessError,setAccessError]=useState(''),[editNote,setEditNote]=useState(''),[editRevision,setEditRevision]=useState(1);
 const [activeRoles,setActiveRoles]=useState<string[]>([]),[subjectPermissions,setSubjectPermissions]=useState<string[]|null>(null),[revisions,setRevisions]=useState<{id:string;revision:number;title:string;body_text:string|null;created_at:string}[]>([]);
 const [billProfile,setBillProfile]=useState<BillProfile|null>(null),[billFiles,setBillFiles]=useState<BillFile[]>([]),[billConclusion,setBillConclusion]=useState<BillConclusion|null>(null),[billReadiness,setBillReadiness]=useState<BillReadiness|null>(null);
 const [billFinancial,setBillFinancial]=useState(false),[billGovernmentOpinion,setBillGovernmentOpinion]=useState(false),[billCommittee,setBillCommittee]=useState(''),[billRepresentative,setBillRepresentative]=useState(''),[billNote,setBillNote]=useState('');
 const [billFileKind,setBillFileKind]=useState('explanatory_note'),[billFile,setBillFile]=useState<File|null>(null),[billReviewNote,setBillReviewNote]=useState<Record<string,string>>({}),[billDossierOpen,setBillDossierOpen]=useState(false);
 const [createBillFinancial,setCreateBillFinancial]=useState(false),[createBillGovernmentOpinion,setCreateBillGovernmentOpinion]=useState(false),[createBillCommittee,setCreateBillCommittee]=useState(''),[createBillRepresentative,setCreateBillRepresentative]=useState(''),[createBillNote,setCreateBillNote]=useState('');
 const [createBillFiles,setCreateBillFiles]=useState<Record<string,File|null>>({});
 const [committeeRapporteur,setCommitteeRapporteur]=useState(''),[committeeLegal,setCommitteeLegal]=useState(''),[committeeLogic,setCommitteeLogic]=useState(''),[committeeActs,setCommitteeActs]=useState(''),[committeeRecommendation,setCommitteeRecommendation]=useState<'draft'|'proceed'|'return'|'reject'>('draft');
 const [budgetReview,setBudgetReview]=useState<BudgetPreliminaryReview|null>(null),[budgetDocsOk,setBudgetDocsOk]=useState(false),[budgetDistributed,setBudgetDistributed]=useState(false),[budgetAccounts,setBudgetAccounts]=useState(false),[budgetConclusion,setBudgetConclusion]=useState(''),[budgetDecision,setBudgetDecision]=useState<'draft'|'accept'|'return'>('draft'),[budgetReviewNote,setBudgetReviewNote]=useState('');
 const [localRefresh,setLocalRefresh]=useState(0);
 const [documentSignatures,setDocumentSignatures]=useState<{id:string;signer_id:string;signed_at:string;history_id:number;url:string|null}[]>([]);

 const role=[me?.role_title||'',...activeRoles].join(' ').toLowerCase();
 const availableSubjects=useMemo(()=>subjectPermissions?FORMAL_SUBJECTS.filter(s=>subjectPermissions.includes(s.key)):teacher?FORMAL_SUBJECTS:FORMAL_SUBJECTS.filter(s=>s.roleHints.some(h=>role.includes(h))),[teacher,role,subjectPermissions]);
 const createType=FORMAL_TYPES.find(x=>x.key===docType),creatingBill=createType?.workflow==='bill';
 const createBillRepresentativeRequired=['government','sf','region','ks','vs'].includes(subjectKey);
 const createBillRequiredKinds=['explanatory_note','affected_acts',...(createBillFinancial?['financial_economic']:[]),...(createBillGovernmentOpinion?['government_opinion']:[]),...(createBillRepresentativeRequired?['collegial_decision']:[])];
 const createBillPreparedCount=createBillRequiredKinds.filter(k=>!!createBillFiles[k]).length;
 const createBillReady=!!createBillCommittee&&(!createBillRepresentativeRequired||!!createBillRepresentative)&&createBillPreparedCount===createBillRequiredKinds.length;
 useEffect(()=>{if(!g.game?.id||readOnly)return;let active=true;async function load(){const r=await supabase.rpc('get_formal_subjects',{p_game_id:g.game!.id});if(active&&!r.error&&Array.isArray(r.data))setSubjectPermissions(r.data)}void load();const timer=setInterval(()=>void load(),30000);return()=>{active=false;clearInterval(timer)}},[g.game?.id,me?.user_id,me?.role_title,readOnly]);
 useEffect(()=>{if(!g.game?.id||!me?.user_id)return;let active=true;async function load(){const r=await supabase.from('game_office_assignments').select('role_title').eq('game_id',g.game!.id).eq('user_id',me!.user_id).eq('status','active');if(active&&!r.error)setActiveRoles((r.data||[]).map(x=>x.role_title))}void load();const timer=setInterval(()=>void load(),30000);return()=>{active=false;clearInterval(timer)}},[g.game?.id,me?.user_id]);
 const filtered=useMemo(()=>formalDocuments.filter(d=>{
  const q=query.trim().toLowerCase();
  const voting=votes.some(v=>v.formal_document_id===d.id&&v.status==='open');
  const statusOk=!filterStatus
   ||filterStatus==='__voting__'&&voting
   ||filterStatus==='__active__'&&!['published','rejected'].includes(d.status_code)
   ||filterStatus==='__accepted__'&&['published','signed','adopted'].includes(d.status_code)
   ||(!filterStatus.startsWith('__')&&d.status_code===filterStatus);
  return(!q||[d.registry_no,d.title,d.subject_label,typeLabel(d.doc_type),d.status_label,members.find(m=>m.user_id===d.author_id)?.full_name].join(' ').toLowerCase().includes(q))&&(!filterSubject||d.subject_key===filterSubject)&&statusOk
 }).sort((a,b)=>sortOrder==='title'?a.title.localeCompare(b.title,'ru'):Date.parse(b[sortOrder==='created'?'created_at':'updated_at'])-Date.parse(a[sortOrder==='created'?'created_at':'updated_at'])),[formalDocuments,votes,members,query,filterSubject,filterStatus,sortOrder]);
 const selected=useMemo(()=>filtered.find(d=>d.id===selectedId)||filtered[0],[filtered,selectedId]);
 useEffect(()=>{setDocumentAccess(null);setAccessError('');if(!selected?.id)return;let active=true;void Promise.all([supabase.rpc('get_formal_document_tools',{p_document_id:selected.id}),supabase.from('formal_document_revisions').select('id,revision,title,body_text,created_at').eq('document_id',selected.id).order('revision',{ascending:false})]).then(([a,r])=>{if(!active)return;if(a.error)setAccessError(a.error.message);else setDocumentAccess(a.data as DocumentAccess);if(!r.error)setRevisions(r.data||[])});return()=>{active=false}},[selected?.id,selected?.updated_at,localRefresh]);
 useEffect(()=>{
  if(!selected?.id){setDocumentSignatures([]);return}
  let current=true;
  void (async()=>{
   const res=await supabase.from('formal_document_signatures')
    .select('id,signer_id,signed_at,history_id,signature_path').eq('document_id',selected.id).order('signed_at',{ascending:false});
   if(res.error||!current)return;
   const items=await Promise.all((res.data||[]).map(async row=>({
    ...row,url:(await supabase.storage.from('game-assets').createSignedUrl(row.signature_path,3600)).data?.signedUrl||null
   })));
   if(current)setDocumentSignatures(items);
  })();
  return()=>{current=false};
 },[selected?.id,selected?.updated_at,formalHistory.length]);
 const lastSigned=documentSignatures[0];
 const [committeeUnits,setCommitteeUnits]=useState<{unit_key:string;title:string;head_user_id:string|null}[]>([]);
 useEffect(()=>{if(!me||!g.game)return;void supabase.from('institution_units').select('unit_key,title,head_user_id').eq('game_id',g.game.id).eq('unit_kind','committee').then(r=>{if(!r.error)setCommitteeUnits((r.data||[]) as any)})},[me?.user_id,g.game?.id]);
 useEffect(()=>{if(focusId&&formalDocuments.some(d=>d.id===focusId)){setQuery('');setFilterSubject('');setFilterStatus('');setSelectedId(focusId);setDetailReturn('registry');setDetailOpen(true);setMode('registry')}},[focusId]);
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

 useEffect(()=>{if(!createTemplate||readOnly)return;const t=DOCUMENT_TEMPLATES.find(x=>x.key===createTemplate);if(!t)return;setTemplateKey(t.key);setTitle(t.title);setBody(t.body);setDocType(t.docType);setSubjectKey(t.subject);setFile(null);setRecognized('Образец для этапа '+(createStageNo||currentStage?.stage_no||1)+'. Проверьте субъект и заполните поля в квадратных скобках.');setDetailOpen(false);setMode('create')},[createTemplate,createStageNo,readOnly]);
 const history=selected?formalHistory.filter(h=>h.document_id===selected.id).slice().reverse():[];
 const author=selected?members.find(m=>m.user_id===selected.author_id):undefined;
 const subject=selected?FORMAL_SUBJECTS.find(s=>s.key===selected.subject_key):undefined;
 const personalSigner=selected&&['gd_deputy','sf_member','region','ks','vs'].includes(selected.subject_key);
 const signatureHolder=selected?(personalSigner?author:(members.find(m=>subject?.roleHints.some(h=>(m.role_title||'').toLowerCase().includes(h)))||author)):undefined;
 const signature=selected?formalSignature(selected.subject_key,signatureHolder?.full_name||author?.full_name||'________________'):null;

 function canManage(doc:FormalDocument){
  if(doc.id===selected?.id&&documentAccess)return !readOnly&&documentAccess.can_manage;
  if(readOnly)return false;if(teacher)return true;if(!me)return false;if(doc.current_owner_key==='author')return doc.author_id===me.user_id;
  const rt=role;
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
   const res=await fetch((process.env.NEXT_PUBLIC_GAME_API_ORIGIN||'')+'/api/extract-document',{method:'POST',body:fd});const data=await res.json();
   if(!res.ok){setRecognized(data.error||'Не удалось распознать текст. Файл всё равно можно прикрепить.');return}
   const baseTitle=title||next.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ');if(!title)setTitle(baseTitle);
   const extracted=typeof data.text==='string'?data.text:'';
   if(extracted)setBody(extracted);
   const found=inferFormal(extracted,baseTitle,me?.role_title);
   if(teacher||availableSubjects.some(s=>s.key===found.subject.key))setSubjectKey(found.subject.key);else if(availableSubjects[0])setSubjectKey(availableSubjects[0].key);
   setDocType(found.type.key);
   setRecognized(extracted?('✓ Текст извлечён'+(data.pages?' · '+data.pages+' стр.':'')+' · '+found.type.label+' · '+found.subject.short):('✓ Файл прикреплён · предварительно: '+found.type.label+' · '+found.subject.short+'. Вставьте текст ниже для точного распознавания.'));
  }catch(e){setRecognized(userError(e)||'Ошибка распознавания')}finally{setExtracting(false)}
 }

 function chooseSubject(key:string){setSubjectKey(key);const s=FORMAL_SUBJECTS.find(x=>x.key===key);if(s){const current=FORMAL_TYPES.find(x=>x.key===docType);if(!current||current.workflow==='generic'||current.key==='other')setDocType(s.defaultType)}}

 async function savePreparedBillPackage(documentId:string){
  const errors:string[]=[];
  const profile=await supabase.rpc('save_bill_submission_profile',{p_document_id:documentId,p_requires_financial_justification:createBillFinancial,p_requires_government_opinion:createBillGovernmentOpinion,p_committee_key:createBillCommittee||null,p_representative_user_id:createBillRepresentative||null,p_note:createBillNote.trim()||null});
  if(profile.error)errors.push('Карточка внесения: '+profile.error.message);
  if(!g.game)return [...errors,'Игра недоступна для загрузки приложений'];
  for(const [kind,nextFile] of Object.entries(createBillFiles)){
   if(!nextFile)continue;
   const ext=(nextFile.name.split('.').pop()||'bin').toLowerCase();
   const storagePath=g.game.id+'/formal/'+documentId+'/package/'+crypto.randomUUID()+'.'+ext;
   const up=await supabase.storage.from('game-assets').upload(storagePath,nextFile,{contentType:nextFile.type||'application/octet-stream'});
   if(up.error){errors.push((billFileLabels[kind]||kind)+': '+up.error.message);continue}
   const added=await supabase.rpc('add_bill_package_file',{p_document_id:documentId,p_file_kind:kind,p_title:billFileLabels[kind]||nextFile.name,p_storage_path:storagePath,p_file_name:nextFile.name,p_mime_type:nextFile.type||null,p_file_size:nextFile.size});
   if(added.error)errors.push((billFileLabels[kind]||kind)+': '+added.error.message);
  }
  return errors;
 }
 function resetPreparedBillPackage(){setCreateBillFinancial(false);setCreateBillGovernmentOpinion(false);setCreateBillCommittee('');setCreateBillRepresentative('');setCreateBillNote('');setCreateBillFiles({})}

 async function create(){
  const s=FORMAL_SUBJECTS.find(x=>x.key===subjectKey),t=FORMAL_TYPES.find(x=>x.key===docType);if(!s||!t||title.trim().length<3)return;
  const personalSigner=['gd_deputy','sf_member','region','ks','vs'].includes(s.key);
  const holder=personalSigner?me:(members.find(m=>s.roleHints.some(h=>(m.role_title||'').toLowerCase().includes(h)))||me);const signatureMeta=formalSignature(s.key,holder?.full_name||me?.full_name||'');
  setBusy(true);
  const id=await createFormalDocument({stageNo:createStageNo||currentStage?.stage_no||12,title:title.trim(),docType:t.key,subjectKey:s.key,subjectLabel:s.label,bodyText:body,workflowKey:t.workflow,metadata:{institution:s.label,issuer_name:issuer.trim()||s.label,place:place.trim()||'Москва',template_key:templateKey,recognized:recognized||null,created_in_editor:!file}},file||undefined);
  let packageErrors:string[]=[];
  if(id&&t.workflow==='bill')packageErrors=await savePreparedBillPackage(id);
  setBusy(false);
  if(id){setSelectedId(id);onSelectDocument?.(id);setDetailReturn('create');setDetailOpen(true);setMode('registry');setDetailTab('procedure');setTitle('');setBody('');setFile(null);setRecognized('');resetPreparedBillPackage();if(packageErrors.length)g.setError('Документ зарегистрирован, но комплект внесения сохранён не полностью: '+packageErrors.join(' · '))}
 }

 useEffect(()=>{setEditing(false);setBillDossierOpen(false)},[selected?.id]);
 useEffect(()=>{
  if(!scrollOpenedDocument||!detailOpen||!selectedId)return;
  const frame=requestAnimationFrame(()=>{
   document.getElementById('npa-document-workspace')?.scrollIntoView({behavior:'smooth',block:'start'});
   setScrollOpenedDocument(false);
  });
  return()=>cancelAnimationFrame(frame);
 },[scrollOpenedDocument,detailOpen,selectedId]);
 function startEdit(doc:FormalDocument){setEditRevision(Number(doc.metadata?.revision||1));setEditTitle(doc.title);setEditBody(doc.body_text||'');setEditNote('');setEditing(true)}
 async function saveEdit(){if(!selected)return;setBusy(true);const ok=await updateFormalDraft(selected.id,editTitle,editBody,{edit_note:editNote,expected_revision:editRevision});setBusy(false);if(ok){setEditing(false);setLocalRefresh(n=>n+1)}}
 const canEditSelected=!readOnly&&!!selected&&(documentAccess?.can_edit??(teacher||selected.author_id===me?.user_id&&selected.current_owner_key==='author'))&&!votes.some(v=>v.formal_document_id===selected.id&&v.status==='open');

 const currentAction=selected?.workflow_steps[selected.current_step]?.action;
 const progress=selected?Math.round((selected.current_step/Math.max(1,selected.workflow_steps.length-1))*100):0;
 const showBudgetPreliminary=!!selected&&selected.workflow_key==='budget'&&['budget_registered','budget_committee','budget_council','revision'].includes(selected.status_code);
 const votePreset=selected?votePresetForDocument(selected):null;
 const linkedOpenVote=selected?votes.find(v=>v.formal_document_id===selected.id&&v.status==='open'&&v.formal_step_code===selected.status_code):undefined;
 const lastStepVote=selected?[...votes].filter(v=>v.formal_document_id===selected.id&&v.formal_step_code===selected.status_code).sort((a,b)=>new Date(b.opened_at).getTime()-new Date(a.opened_at).getTime())[0]:undefined;
 const budgetReading1Rejected=!!selected&&selected.workflow_key==='budget'&&selected.status_code==='reading1'&&lastStepVote?.status==='closed'&&lastStepVote.result_code==='rejected';
 const billReadinessRelevant=!!selected&&selected.workflow_key==='bill'&&['draft','revision','committee'].includes(selected.status_code);
 const procedureReadinessPending=billReadinessRelevant&&billReadiness===null;
 const procedureIssues=selected?.workflow_key==='bill'&&['draft','revision'].includes(selected.status_code)?(billReadiness?.issues||[]):selected?.workflow_key==='bill'&&selected.status_code==='committee'?(billReadiness?.review_issues||[]):[];
 const procedureBlocked=procedureReadinessPending||procedureIssues.length>0;
 const packageIssueCount=billReadiness?[...billReadiness.issues,...billReadiness.review_issues].length:0;
 const requiredBillKinds=billReadiness?.required_files||['explanatory_note','affected_acts'];
 const requiredBillPresent=requiredBillKinds.filter(kind=>billFiles.some(file=>file.file_kind===kind)).length;
 const billRepresentativeRequired=!!selected&&['government','sf','region','ks','vs'].includes(selected.subject_key);
 const billProfileReady=!!billCommittee&&(!billRepresentativeRequired||!!billRepresentative);
 const billMaterialsReady=requiredBillPresent===requiredBillKinds.length;
 const billSubmissionReady=!!billReadiness?.submission_ready;
 const billCommitteeLabel=committeeUnits.find(unit=>unit.unit_key===billCommittee)?.title||'Не выбран';
 const billRepresentativeLabel=members.find(member=>member.user_id===billRepresentative)?.full_name||'Не указан';
 const missingBillMaterialLabels=requiredBillKinds.filter(kind=>!billFiles.some(file=>file.file_kind===kind)).map(kind=>billFileLabels[kind]||kind);
 const billCommitteeStepIndex=selected?.workflow_key==='bill'?selected.workflow_steps.findIndex(step=>step.code==='committee'):-1;
 const showBillCommitteeReadiness=!!selected&&billCommitteeStepIndex>=0&&selected.current_step>=billCommitteeStepIndex;
 const billReadinessStepsTotal=showBillCommitteeReadiness?3:2;
 const billReadinessStepsDone=Number(billProfileReady)+Number(billMaterialsReady)+Number(showBillCommitteeReadiness&&!!billReadiness?.committee_ready);
 const billReadinessPercent=Math.round(billReadinessStepsDone/billReadinessStepsTotal*100);
 const canMaintainBillPackage=!!selected&&!readOnly&&(teacher||selected.author_id===me?.user_id||canManage(selected));
 function focusBillPackage(){setBillDossierOpen(true);requestAnimationFrame(()=>document.getElementById('bill-submission-package')?.scrollIntoView({behavior:'smooth',block:'start'}))}
 async function openProceduralVote(){
  if(!selected||!votePreset||busy||readOnly||!canManage(selected))return;
  setBusy(true);
  try{
   const ok=await createVote({...votePreset,formalDocumentId:selected.id});
   if(ok){const r=await supabase.from('game_votes').select('id').eq('formal_document_id',selected.id).eq('formal_step_code',selected.status_code).eq('status','open').maybeSingle();onOpenVotes(r.data?.id)}
  }finally{setBusy(false)}
 }
 const requiresVote=(doc:FormalDocument)=>doc.workflow_steps.some(step=>!!votePresetForDocument({...doc,status_code:step.code}));
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

 function openRegistryDocument(id:string){
  setSelectedId(id);
  onSelectDocument?.(id);
  setDetailReturn('registry');
  setDetailOpen(true);
  setDetailTab('text');
  setEditing(false);
  setScrollOpenedDocument(true);
 }

 return <div className="formalPage legalPortal">
  <section className="formalHero"><div><small>ПРАВОВАЯ ИНФОРМАЦИЯ ИГРЫ</small><h1>Официальный интернет-портал правовой информации</h1><p>Документы органов власти, их тексты, стадии рассмотрения и связанные голосования.</p></div><div className="formalHeroActions"><a href="https://sozd.duma.gov.ru/" target="_blank" rel="noreferrer">СОЗД ГД ↗</a><a href="https://publication.pravo.gov.ru/" target="_blank" rel="noreferrer">Официальное опубликование ↗</a></div></section>

  <section className="formalStats"><article><small>ВСЕГО В РЕЕСТРЕ</small><strong>{formalDocuments.length}</strong><span>документов</span></article><article><small>В ПРОЦЕССЕ</small><strong>{formalDocuments.filter(d=>!['published','rejected'].includes(d.status_code)).length}</strong><span>движутся по процедуре</span></article><article><small>Принято</small><strong>{formalDocuments.filter(d=>['published','signed','adopted'].includes(d.status_code)).length}</strong><span>принятых актов</span></article><article><small>МОИ ДОКУМЕНТЫ</small><strong>{formalDocuments.filter(d=>d.author_id===me?.user_id).length}</strong><span>инициировано вами</span></article></section>

  <DocumentInbox gameId={g.game?.id} userId={me?.user_id} members={members} documents={formalDocuments} onOpen={id=>{setSelectedId(id);onSelectDocument?.(id);setQuery('');setFilterSubject('');setFilterStatus('');setDetailReturn('registry');setMode('registry');setDetailOpen(true);setDetailTab('text')}}/>
  <nav className="formalTabs legalPrimaryNav" aria-label="Разделы правового портала"><button className={mode==='create'?'active':''} onClick={()=>setMode('create')}><FilePlus2 size={20}/> Создать / загрузить</button><button className={mode==='registry'?'active':''} onClick={()=>{setMode('registry');setDetailOpen(false);onSelectDocument?.()}}><BookOpen size={20}/> Реестр НПА <span>{formalDocuments.length}</span></button></nav>

  {mode==='create'&&<section className="formalCreate legalCreateV2" aria-labelledby="create-document-title">
   <header className="legalCreateIntro"><div><small>НОВЫЙ НПА</small><h2 id="create-document-title">Создать или загрузить документ</h2><p>Добавьте текст, проверьте реквизиты, подготовьте обязательные материалы и зарегистрируйте документ. Официальное движение по процедуре начнётся уже из карточки НПА.</p></div><ol className="legalCreateSteps"><li><b>1</b><span>Документ</span></li><li><b>2</b><span>Реквизиты</span></li><li className={creatingBill?'active':''}><b>3</b><span>{creatingBill?'Комплект внесения':'Регистрация'}</span></li></ol></header>
   <div className="formalCreateForm">
    <section className="legalCreateSection"><header><span>1</span><div><small>ИСХОДНЫЙ МАТЕРИАЛ</small><h3>Документ</h3><p>Импортируйте файл, используйте образец или вставьте текст вручную.</p></div></header>
     <CloudDocumentPicker gameId={g.game?.id} userId={me?.user_id} disabled={readOnly||busy} onImport={(nextTitle,text,url)=>{setTitle(nextTitle);setBody(text);setFile(null);applyInference(text,nextTitle);setRecognized('Текст импортирован из '+url)}}/>
     <div className="legalTemplatePicker"><StyledSelect label="Образец документа" value={templateKey} onChange={setTemplateKey} options={DOCUMENT_TEMPLATES.map(t=>({value:t.key,label:t.title}))}/><button type="button" className="secondary" onClick={()=>{const t=DOCUMENT_TEMPLATES.find(x=>x.key===templateKey);if(t){setTitle(t.title);setBody(t.body);setDocType(t.docType);if(t.key.startsWith('party_'))setIssuer(me?.team||'Политическая партия [наименование]');else setIssuer(t.subject==='ministry'?(me?.role_title?.replace(/^Министр/,'Министерство')||'Федеральное министерство'):'');if(teacher||availableSubjects.some(x=>x.key===t.subject))setSubjectKey(t.subject);setRecognized('Образец загружен. Заполните поля в квадратных скобках.')}}}>Использовать образец</button></div>
     <div className="formalFileDrop"><input aria-label="Загрузить документ для распознавания" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={e=>{const x=e.target.files?.[0];if(x)void extractFile(x)}}/><div><span>⇧</span><b>{file?file.name:'Загрузить PDF, DOCX или TXT'}</b><small>{extracting?'Извлекаю текст…':'Исходный файл сохранится вместе с НПА'}</small></div></div>
     <div className="formalEditorHead"><label>Текст документа</label><button type="button" onClick={()=>applyInference()}>◇ Распознать реквизиты</button></div><textarea aria-label="Текст документа" className="formalTextEditor" value={body} onChange={e=>setBody(e.target.value)} placeholder="Вставьте полный текст документа…"/>
    </section>
    <section className="legalCreateSection"><header><span>2</span><div><small>КАРТОЧКА НПА</small><h3>Реквизиты и маршрут</h3><p>Вид акта и субъект определяют официальный маршрут документа.</p></div></header>
     {recognized&&<div className="recognitionResult">{recognized}</div>}<div className="formalInputBlock"><label>Название документа</label><input aria-label="Название документа" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Например: О внесении изменений в Федеральный закон…"/></div>
     <div className="formalRecognitionGrid"><StyledSelect label="Субъект" value={subjectKey} onChange={chooseSubject} options={availableSubjects.map(x=>({value:x.key,label:x.label}))}/><StyledSelect label="Вид документа" value={docType} onChange={setDocType} options={FORMAL_TYPES.map(x=>({value:x.key,label:x.label}))}/></div>
     <div className="legalIssuerFields"><label>Наименование органа<input value={issuer} onChange={e=>setIssuer(e.target.value)} placeholder={FORMAL_SUBJECTS.find(x=>x.key===subjectKey)?.label}/></label><label>Место издания<input value={place} onChange={e=>setPlace(e.target.value)}/></label></div>
     <p className="legalEditorNote"><Route size={16}/> Номер и дата присваиваются при регистрации. После регистрации официальные переходы выполняются в блоке управления процедурой рядом с документом.</p>
    </section>
    {creatingBill&&<section className="legalCreateSection billCreatePackage"><header><span>3</span><div><small>ЗАКОНОПРОЕКТ · КОМПЛЕКТ ВНЕСЕНИЯ</small><h3>Материалы для Государственной Думы</h3><p>Это прежнее «досье законопроекта», встроенное туда, где оно реально нужно — в подготовку законопроекта.</p></div><strong className={createBillReady?'ready':'draft'}>{createBillReady?<><CheckCircle2 size={16}/> Готов к внесению</>:<><CircleAlert size={16}/> Черновик комплекта</>}</strong></header>
     <div className="billCreateChecks"><label><input type="checkbox" checked={createBillFinancial} onChange={e=>setCreateBillFinancial(e.target.checked)}/> Требуется финансово-экономическое обоснование</label><label><input type="checkbox" checked={createBillGovernmentOpinion} onChange={e=>setCreateBillGovernmentOpinion(e.target.checked)}/> Требуется заключение Правительства РФ</label></div>
     <div className="billCreateFields"><StyledSelect label="Профильный комитет" value={createBillCommittee} onChange={setCreateBillCommittee} options={[{value:'',label:'Выберите комитет'},...committeeUnits.map(x=>({value:x.unit_key,label:x.title}))]}/><StyledSelect label={createBillRepresentativeRequired?'Представитель в Государственной Думе':'Представитель в ГД (необязательно)'} value={createBillRepresentative} onChange={setCreateBillRepresentative} options={[{value:'',label:createBillRepresentativeRequired?'Выберите представителя':'Не указан'},...members.filter(m=>m.kind==='student').map(m=>({value:m.user_id,label:m.full_name}))]}/></div>
     <label className="billCreateNote">Комментарий к внесению<textarea rows={2} maxLength={2000} value={createBillNote} onChange={e=>setCreateBillNote(e.target.value)} placeholder="Кратко укажите цель внесения"/></label>
     <div className="billCreateAttachments"><div className="billCreateAttachmentsHead"><div><Paperclip size={18}/><b>Обязательные приложения</b></div><span>{createBillPreparedCount} из {createBillRequiredKinds.length} выбрано</span></div>{createBillRequiredKinds.map(kind=>{const nextFile=createBillFiles[kind];return <label key={kind} className={nextFile?'has-file':''}><span><b>{billFileLabels[kind]||kind}</b><small>{nextFile?nextFile.name:'PDF, DOC/DOCX или TXT'}</small></span><input type="file" accept=".pdf,.doc,.docx,.txt" onChange={e=>setCreateBillFiles(v=>({...v,[kind]:e.target.files?.[0]||null}))}/><em>{nextFile?'Заменить':'Выбрать файл'}</em></label>})}</div>
     <p className="billCreateRule"><ClipboardList size={17}/> Зарегистрировать черновик можно и с неполным комплектом. Но официальный переход «Внести в Государственную Думу» будет доступен только после заполнения обязательных материалов.</p>
    </section>}
    <div className="formalCreateFooter"><div className="legalStageValue"><span>Этап игры:</span><b>{createStageNo||currentStage?.stage_no||'—'}</b></div><button type="button" className="primary" disabled={busy||title.trim().length<3||(!teacher&&!availableSubjects.length)} onClick={create}>{busy?'Регистрирую и сохраняю комплект…':'Зарегистрировать документ →'}</button></div>
   </div>
  </section>}

  {mode==='registry'&&<section className="formalWorkspace"><aside className="formalRegistry registryDashboard" hidden={detailOpen}>
    <header className="formalRegistryHead registryDashboardHead">
     <div><small>РЕЕСТР НПА</small><h2>Документы игры</h2><p>Единое рабочее пространство для поиска, контроля стадии и открытия нормативных документов.</p></div>
     <button type="button" className="primary legalNewDocumentButton" onClick={()=>setMode('create')}><Plus size={17}/> Новый документ</button>
    </header>

    <div className="registryToolbar">
     <label className="registrySearch"><Search size={18} aria-hidden="true"/><input aria-label="Поиск в реестре НПА" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Номер, название, орган или автор"/>{query&&<button type="button" aria-label="Очистить поиск" onClick={()=>setQuery('')}><X size={16}/></button>}</label>
     <div className="registryFilterGrid">
      <StyledSelect label="Субъект" value={filterSubject} onChange={setFilterSubject} options={[{value:'',label:'Все субъекты'},...FORMAL_SUBJECTS.map(x=>({value:x.key,label:x.short}))]}/>
      <StyledSelect label="Стадия" value={filterStatus} onChange={setFilterStatus} options={[{value:'',label:'Все стадии'},{value:'__active__',label:'В процессе'},{value:'__voting__',label:'Идёт голосование'},{value:'__accepted__',label:'Принято'},{value:'draft',label:'Черновик'},{value:'registered',label:'Регистрация'},{value:'committee',label:'Комитет'},{value:'reading1',label:'I чтение'},{value:'reading2',label:'II чтение'},{value:'reading3',label:'III чтение'},{value:'president',label:'Президент'},{value:'published',label:'Опубликован'},{value:'rejected',label:'Отклонён'}]}/>
      <StyledSelect label="Порядок" value={sortOrder} onChange={setSortOrder} options={[{value:'updated',label:'Сначала обновлённые'},{value:'created',label:'Сначала новые'},{value:'title',label:'По названию'}]}/>
     </div>
    </div>

    <div className="registryResultsHead">
     <div><small>РЕЗУЛЬТАТЫ</small><b>{filtered.length} из {formalDocuments.length}</b><span>{filterStatus||filterSubject||query?'Показаны документы по выбранным условиям':'Все документы реестра'}</span></div>
     {(query||filterSubject||filterStatus||sortOrder!=='updated')&&<button type="button" className="secondary" onClick={()=>{setQuery('');setFilterSubject('');setFilterStatus('');setSortOrder('updated')}}>Сбросить фильтры</button>}
    </div>

    <div className="formalRegistryList legalRegistryRows registryCards">{filtered.length?filtered.map(d=>{
     const voting=votes.some(v=>v.formal_document_id===d.id&&v.status==='open');
     const totalSteps=Math.max(1,d.workflow_steps.length);
     const step=Math.min(totalSteps,Math.max(1,d.current_step+1));
     const completion=Math.round(step/totalSteps*100);
     return <article key={d.id} className={selected?.id===d.id?'formalRegistryRow legalDocumentRow registryCard active':'formalRegistryRow legalDocumentRow registryCard'} onClick={e=>{if((e.target as HTMLElement).closest('button,a,input,select'))return;openRegistryDocument(d.id)}}>
      <header className="registryCardHead"><div className="registryCardIdentity"><span>{d.registry_no}</span><small>{typeLabel(d.doc_type)}</small></div><em className={'formalStatus '+statusTone(d.status_code)}>{d.status_label}</em></header>
      <div className="registryCardTitle"><h3>{d.title}</h3><p>{d.subject_label}</p></div>
      <div className="registryCardProgress"><div><span>Этап {step} из {totalSteps}</span><b>{ownerLabel(d.current_owner_key)}</b></div><div className="registryCardProgressTrack" aria-label={'Прогресс документа '+completion+'%'}><i style={{width:completion+'%'}}/></div></div>
      <div className="registryCardMeta"><span><Clock3 size={14}/> Обновлён {shortDate(d.updated_at)}</span>{voting&&<strong><Vote size={14}/> Идёт голосование</strong>}</div>
      <footer className="formalRegistryRowActions"><span>Ответственный: {ownerLabel(d.current_owner_key)}</span><div className="formalRegistryActions">{votes.find(v=>v.formal_document_id===d.id&&v.status==='open')&&<button type="button" className="legalVoteShortcut" onClick={()=>onOpenVotes(votes.find(v=>v.formal_document_id===d.id&&v.status==='open')?.id)}>Голосование</button>}<button type="button" className="legalOpenDocument" onClick={()=>openRegistryDocument(d.id)}>Открыть документ →</button></div></footer>
     </article>
    }):<div className="registryEmptyState"><Search size={26}/><div><b>Документы не найдены</b><span>Измените запрос или сбросьте фильтры.</span></div><button type="button" className="secondary" onClick={()=>{setQuery('');setFilterSubject('');setFilterStatus('')}}>Показать все</button></div>}</div>
   </aside>

   <article id="npa-document-workspace" className="formalDetail" hidden={!detailOpen} data-tab="unified"><div className="legalDetailToolbar legalUnifiedToolbar"><button type="button" className="secondary legalBackToRegistry" onClick={()=>{setDetailOpen(false);onSelectDocument?.();setEditing(false);if(detailReturn==='create')setMode('create')}}>{detailReturn==='create'?<FilePlus2 size={18}/>:<ArrowLeft size={18}/>} {detailReturn==='create'?'Создать документ':'Реестр НПА'}</button><div className="legalWorkspaceLabel"><small>РАБОЧАЯ КАРТОЧКА НПА</small><b>Документ и процедура</b></div>{canEditSelected&&!editing?<button className="secondary legalEditDocument" onClick={()=>startEdit(selected)}>Редактировать текст</button>:editing?<span className="legalEditingBadge">Редактирование включено</span>:null}</div>{!selected?<div className="formalEmptyBig"><span>▤</span><h2>{formalDocuments.length?'Документы не найдены':'Реестр пока пуст'}</h2><p>{formalDocuments.length?'Измените запрос или фильтры, чтобы выбрать документ.':'Создайте нормативный документ — здесь будут текст, стадии и связанные голосования.'}</p>{formalDocuments.length>0&&<button className="secondary" onClick={()=>{setQuery('');setFilterSubject('');setFilterStatus('')}}>Сбросить фильтры</button>}<button className="primary" onClick={()=>setMode('create')}>Создать документ</button></div>:<>
    <header className="documentSummaryHeader"><div><span>{selected.registry_no} · Этап {selected.stage_no}</span><b>{typeLabel(selected.doc_type)}</b><small>Редакция {String(selected.metadata?.revision||1)} · {selected.subject_label}</small></div><div className="documentSummaryState"><span className={'formalStatus '+statusTone(selected.status_code)}>{selected.status_label}</span><small>Ответственный: {ownerLabel(selected.current_owner_key)}</small></div></header>
    {accessError&&<p className="error" role="alert">{accessError}</p>}
    <section className="legalUnifiedWorkspace" aria-label="Рабочее пространство нормативного документа">
     <main className="legalDocumentColumn">
      <DocumentPaper document={selected} history={history} members={members} signature={editing?undefined:lastSigned} footerSlot={<button type="button" className="secondary legalPrintButton" onClick={()=>window.print()}><Printer size={17} aria-hidden="true"/> Печать</button>} titleSlot={editing?<input aria-label="Название редактируемого документа" className="formalEditTitle" value={editTitle} onChange={e=>setEditTitle(e.target.value)}/>:undefined}>{editing?<><label className="documentEditBodyLabel">Текст документа<textarea aria-label="Редактируемый текст документа" className="formalEditBody" value={editBody} onChange={e=>setEditBody(e.target.value)}/></label><label className="documentEditNote">Основание изменения<input value={editNote} onChange={e=>setEditNote(e.target.value)} maxLength={2000} placeholder="Например: Поправка к статье 2"/></label><div className="formalEditActions"><button className="primary" disabled={busy||editTitle.trim().length<3} onClick={saveEdit}>Сохранить текст</button><button className="secondary" disabled={busy} onClick={()=>setEditing(false)}>Отмена</button></div></>:<div className="formalPaperBody">{selected.body_text?<p>{selected.body_text}</p>:<p className="muted">Текст в системе не сохранён. Используйте прикреплённый оригинал.</p>}</div>}</DocumentPaper>
      <DocumentTools document={selected} access={documentAccess} members={members} readOnly={readOnly||editing} onRefresh={async()=>{await g.refresh();setLocalRefresh(n=>n+1)}}/>
     </main>
     <aside className="legalControlRail" aria-label="Управление документом">
      <article className="surface formalActions"><div className="surfaceHead"><div><small>ТЕКУЩАЯ СТАДИЯ</small><h2>Что нужно сделать сейчас</h2></div></div>
       <div className="documentNextStep"><span>{selected.current_step+1} из {selected.workflow_steps.length}</span><h3>{selected.workflow_steps[selected.current_step]?.label||selected.status_label}</h3><p>Ответственный: <b>{ownerLabel(selected.current_owner_key)}</b>.</p><p>{linkedOpenVote?"Завершите открытое голосование — его результат автоматически изменит стадию.":votePreset?"Для перехода дальше требуется решение голосованием.":procedureBlocked?"Сначала подготовьте обязательный комплект законопроекта.":currentAction?"Доступное действие: "+currentAction+".":"Процедура завершена."}</p>{!canManage(selected)&&currentAction&&!linkedOpenVote&&<small>Действие выполняет ответственный орган. Для ознакомления документ можно отправить из блока под его текстом.</small>}</div>
       {linkedOpenVote?<div className="formalVoteLink active"><small>● ИДЁТ ГОЛОСОВАНИЕ</small><b>{linkedOpenVote.title}</b><span>Результат автоматически изменит стадию документа.</span><button className="primary" onClick={()=>onOpenVotes(linkedOpenVote.id)}>Перейти к голосованию →</button></div>
       :selected.status_code==='budget_conciliation'?<div className="formalBranchPanel"><small>СОГЛАСИТЕЛЬНАЯ КОМИССИЯ</small><b>Президент отклонил закон о федеральном бюджете</b><p>В соответствии с правилами игры необходимо выработать согласованный вариант либо вернуть проект Правительству на доработку.</p>{canManage(selected)||teacher?<div><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await resolveBudgetConciliation(selected.id,'agreed','Согласованный вариант выработан');setBusy(false)}}>✓ Согласованный вариант готов</button><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);await resolveBudgetConciliation(selected.id,'government_revision','Возвращено Правительству');setBusy(false)}}>↺ Вернуть Правительству</button></div>:<span>Ожидается решение согласительной комиссии.</span>}</div>
       :selected.status_code==='president'&&canManage(selected)?<div className="presidentialDecision"><small>РЕШЕНИЕ ПРЕЗИДЕНТА РФ</small><b>{selected.workflow_key==='budget'?'Федеральный бюджет поступил Президенту':'Закон поступил на промульгацию'}</b><p>{selected.workflow_key==='budget'?'Президент может подписать закон о бюджете либо отклонить его; при отклонении запускается согласительная процедура.':'Президент может подписать федеральный закон либо отклонить его. При вето Государственная Дума сможет поставить вопрос о преодолении вето.'}</p><div><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await advanceFormalDocument(selected.id,'advance','Подписано Президентом Российской Федерации');setBusy(false)}}>Подписать →</button><button className="vetoButton" disabled={busy} onClick={async()=>{if(!confirm('Отклонить документ Президентом Российской Федерации?'))return;setBusy(true);await vetoFormalDocument(selected.id,'Отклонено Президентом Российской Федерации');setBusy(false)}}>Наложить вето</button></div></div>
       :budgetReading1Rejected&&canManage(selected)?<div className="formalBranchPanel warning"><small>БЮДЖЕТ ОТКЛОНЁН В I ЧТЕНИИ</small><b>Выберите дальнейшую процедуру</b><p>Правила допускают согласительную комиссию, возврат проекта Правительству на доработку либо постановку вопроса о доверии Правительству.</p><div><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await startBudgetRejectionBranch(selected.id,'conciliation','После отклонения в I чтении');setBusy(false)}}>Согласительная комиссия</button><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);await startBudgetRejectionBranch(selected.id,'government_revision','Возврат бюджета Правительству после I чтения');setBusy(false)}}>Вернуть Правительству</button><button className="secondary" onClick={()=>onOpenVotes()}>Вопрос о доверии →</button></div></div>
       :votePreset?<div className={'formalVoteLink legal-'+votePreset.legalMode}><small>{votePreset.badge}</small><b>Требуется решение голосованием</b><span>{votePreset.rule}</span><p className="formalLegalBasis"><i>{votePreset.legalMode==='law'?'Действующее право':votePreset.legalMode==='reduction'?'Право + учебная редукция':'Правило игры'}</i>{votePreset.legalBasis}</p><>{canManage(selected)?<button className="primary" disabled={busy||readOnly} onClick={openProceduralVote}>{busy?'Открывается…':'Начать голосование по документу'}</button>:<span>Голосование открывает ответственный институт или преподаватель.</span>}</></div>
       :currentAction?canManage(selected)?procedureBlocked?<div className="documentActionGate" role="status"><CircleAlert size={20}/><div><b>{procedureReadinessPending?'Проверяю комплект…':'Комплект внесения не готов'}</b><p>{procedureReadinessPending?'Система проверяет обязательные материалы.':'Недостающие пункты показаны ниже в едином блоке «Комплект внесения».'}</p></div>{!procedureReadinessPending&&<button type="button" className="secondary" onClick={focusBillPackage}>Исправить комплект</button>}</div>:<><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);await advanceFormalDocument(selected.id,'advance');setBusy(false)}}>{currentAction} →</button>{selected.current_owner_key!=='author'&&<div className="formalSecondaryActions"><button onClick={()=>void advanceFormalDocument(selected.id,'return','Возвращено на доработку')}>↺ Вернуть автору</button><button onClick={()=>{if(confirm('Отклонить документ?'))void advanceFormalDocument(selected.id,'reject','Документ отклонён')}}>× Отклонить</button></div>}</>:<div className="formalWaiting">Ожидается действие другого института. Все участники видят изменение стадии автоматически.</div>
       :<div className="formalWaiting done">Процедура завершена.</div>}</article>
      
      <article className="surface formalPassport"><div className="surfaceHead"><div><small>ПАСПОРТ ДОКУМЕНТА</small><h2>Карточка</h2></div></div><dl><div><dt>Номер</dt><dd>{selected.registry_no}</dd></div><div><dt>Субъект</dt><dd>{selected.subject_label}</dd></div><div><dt>Автор</dt><dd>{author?.full_name||'—'}</dd></div><div><dt>Создан</dt><dd>{fmtDateTime(selected.created_at)}</dd></div><div><dt>Ответственный сейчас</dt><dd>{ownerLabel(selected.current_owner_key)}</dd></div></dl>{selected.file_url&&<a className="formalSourceFile" href={selected.file_url} target="_blank" rel="noreferrer">Открыть исходный файл ↗<small>{selected.source_file_name}</small></a>}</article>
      
     </aside>
    </section>
    <section className={'legalProcedureBottomGrid'+(showBudgetPreliminary?'':' single')} aria-label="Процедура документа">
     {showBudgetPreliminary&&<div className="legalProcedureBottomCol legalBudgetReviewCol"><article className="surface budgetPreliminary"><div className="surfaceHead"><div><small>СТ. 192 БК РФ · ЭТАП 13</small><h2>Предварительная проверка бюджета</h2></div><span className={budgetReview?.decision==='accept'?'ok':budgetReview?.decision==='return'?'bad':'warn'}>{budgetReview?.decision==='accept'?'Принят к рассмотрению':budgetReview?.decision==='return'?'Возврат':'Проверка'}</span></div>
       <p className="budgetPreliminaryIntro">До I чтения Комитет по бюджету проверяет комплектность проекта. После принятия к рассмотрению проект и материалы направляются комитетам ГД и Счётной палате.</p>
       <div className="budgetPreliminaryChecks"><label><input type="checkbox" checked={budgetDocsOk} onChange={e=>setBudgetDocsOk(e.target.checked)}/> Документы и материалы соответствуют требованиям</label><label><input type="checkbox" checked={budgetDistributed} onChange={e=>setBudgetDistributed(e.target.checked)}/> Проект направлен во все комитеты ГД</label><label><input type="checkbox" checked={budgetAccounts} onChange={e=>setBudgetAccounts(e.target.checked)}/> Получено/смоделировано заключение Счётной палаты</label></div>
       <label className="budgetPreliminaryText">Заключение Комитета по бюджету<textarea rows={4} value={budgetConclusion} onChange={e=>setBudgetConclusion(e.target.value)} placeholder="Оцените соответствие комплекта требованиям, полноту материалов и готовность проекта к рассмотрению Государственной Думой."/></label>
       <label className="budgetPreliminaryText">Примечание<textarea rows={2} value={budgetReviewNote} onChange={e=>setBudgetReviewNote(e.target.value)} placeholder="Замечания, условия возврата или организационные сведения"/></label>
       <div className="budgetPreliminaryDecision"><StyledSelect label="Предварительная проверка бюджета" value={budgetDecision} onChange={v=>setBudgetDecision(v as 'draft'|'accept'|'return')} options={[{value:'draft',label:'Черновик решения'},{value:'accept',label:'Принять к рассмотрению'},{value:'return',label:'Вернуть Правительству'}]}/><button className="primary" disabled={busy} onClick={()=>void saveBudgetPreliminary()}>Зафиксировать проверку</button></div>
      </article></div>}
     <div className="legalProcedureBottomCol legalDocumentRouteCol"><section className="formalProgress legalRouting legalRouteBoard" aria-labelledby="legal-document-route-title">
      <header className="legalRouteBoardHead">
       <div><small>ПРОЦЕДУРНАЯ КАРТА</small><h2 id="legal-document-route-title">Маршрут документа</h2><p>Полная последовательность движения документа по установленной процедуре.</p></div>
       <div className="legalRouteBoardStatus"><span>{selected.current_step+1} из {selected.workflow_steps.length}</span><b>{selected.status_label}</b></div>
      </header>
      <div className="legalRouteProgress" aria-label={'Процедура выполнена на '+progress+'%'}>
       <div><span>Начало процедуры</span><strong>{progress}%</strong><span>{progress===100?'Завершено':'Текущая стадия'}</span></div>
       <div className="legalRouteProgressTrack"><i style={{width:progress+'%'}}/></div>
      </div>
      <ol className="legalRouteTimeline" aria-label="Стадии маршрута документа">
       {selected.workflow_steps.map((s,i)=>{
        const routeFinished=progress===100;
        const done=i<selected.current_step||(routeFinished&&i===selected.current_step);
        const current=!routeFinished&&i===selected.current_step;
        const event=[...history].reverse().find(h=>h.to_status===s.code);
        const eventDate=event?.created_at||(i===0?selected.created_at:null);
        const actor=event?.actor_id?members.find(m=>m.user_id===event.actor_id)?.full_name:null;
        return <li key={s.code} className={'legalRouteStep '+(done?'done':current?'current':'pending')}>
         <div className="legalRouteRail" aria-hidden="true"><span>{done?<CheckCircle2 size={20}/>:i+1}</span>{i<selected.workflow_steps.length-1&&<i/>}</div>
         <div className="legalRouteStepBody">
          <div className="legalRouteStepTitle"><small>ЭТАП {i+1}</small><h3>{s.label}</h3></div>
          <div className="legalRouteStepDetails">
           <span><b>Ответственный</b>{ownerLabel(s.owner)}</span>
           {actor&&<span><b>Действие выполнил</b>{actor}</span>}
          </div>
         </div>
         <div className="legalRouteStepState">
          <span>{done?'Завершено':current?'Текущая стадия':'Ожидается'}</span>
          {eventDate&&<time dateTime={eventDate}><Clock3 size={13}/>{new Date(eventDate).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})}</time>}
         </div>
        </li>
       })}
      </ol>
      <footer className="legalRouteBoardFoot">
       <div><Route size={18}/><span><b>{progress===100?'Процедура завершена':'Документ находится в процедуре'}</b><small>{progress===100?'Все предусмотренные стадии пройдены.':'Сейчас документ находится у: '+ownerLabel(selected.current_owner_key)+'.'}</small></span></div>
       <strong>{selected.workflow_steps.length} {selected.workflow_steps.length===1?'стадия':selected.workflow_steps.length<5?'стадии':'стадий'}</strong>
      </footer>
     </section></div>
    </section>
    <div className="legalBudgetAnnexSlot"><BudgetDocumentAnnex document={selected} onOpenBudget={onOpenBudget} onOpenVotes={onOpenVotes}/></div>
    {selected.workflow_key==='bill'&&<section id="bill-submission-package" className="surface billDossierCompact billReadinessPanel">
      <header className="billDossierCompactHead billReadinessHead">
       <div><small>КОМПЛЕКТ ЗАКОНОПРОЕКТА</small><h2>Комплект внесения</h2><p>Перед движением законопроекта проверьте обязательные блоки ниже. Здесь показано только то, что влияет на готовность документа.</p></div>
       <span className={billReadiness?.committee_ready?'ok':billSubmissionReady?'progress':'bad'}>{billReadiness?.committee_ready?'Готов полностью':billSubmissionReady?'Готов к внесению':'Не готов к внесению'}</span>
      </header>

      <div className="billReadinessProgress">
       <div><span>Готовность комплекта</span><b>{billReadinessStepsDone} из {billReadinessStepsTotal} блоков</b></div>
       <div className="billReadinessProgressTrack" role="progressbar" aria-label="Готовность комплекта законопроекта" aria-valuemin={0} aria-valuemax={100} aria-valuenow={billReadinessPercent}><i style={{width:billReadinessPercent+'%'}}/></div>
      </div>

      <div className="billReadinessSteps">
       <article className={billProfileReady?'ready':'needs-action'}>
        <span className="billReadinessStepNo">{billProfileReady?<CheckCircle2 size={19}/>:1}</span>
        <div className="billReadinessStepCopy">
         <small>ШАГ 1</small><h3>Карточка внесения</h3>
         <p>{billProfileReady?'Основные реквизиты заполнены.':'Заполните обязательные реквизиты законопроекта.'}</p>
         <dl><div><dt>Профильный комитет</dt><dd className={billCommittee?'':'missing'}>{billCommitteeLabel}</dd></div><div><dt>Представитель в ГД</dt><dd className={billRepresentativeRequired&&!billRepresentative?'missing':''}>{billRepresentativeRequired?billRepresentativeLabel:(billRepresentative||'Не требуется')}</dd></div></dl>
        </div>
        <span className="billReadinessStepState">{billProfileReady?'Готово':'Нужно заполнить'}</span>
       </article>

       <article className={billMaterialsReady?'ready':'needs-action'}>
        <span className="billReadinessStepNo">{billMaterialsReady?<CheckCircle2 size={19}/>:2}</span>
        <div className="billReadinessStepCopy">
         <small>ШАГ 2</small><h3>Обязательные материалы</h3>
         <p>{billMaterialsReady?'Все обязательные приложения загружены.':'Добавьте недостающие приложения к законопроекту.'}</p>
         <div className="billMaterialSummary"><b>{requiredBillPresent} из {requiredBillKinds.length}</b><span>{missingBillMaterialLabels.length?'Не хватает: '+missingBillMaterialLabels.join(', '):'Комплект приложений собран'}</span></div>
        </div>
        <span className="billReadinessStepState">{billMaterialsReady?'Готово':requiredBillPresent+' / '+requiredBillKinds.length}</span>
       </article>

       {showBillCommitteeReadiness&&<article className={billReadiness?.committee_ready?'ready':'needs-action'}>
        <span className="billReadinessStepNo">{billReadiness?.committee_ready?<CheckCircle2 size={19}/>:3}</span>
        <div className="billReadinessStepCopy">
         <small>ШАГ 3</small><h3>Заключение профильного комитета</h3>
         <p>{billReadiness?.committee_ready?'Итоговое заключение зафиксировано.':'После проверки материалов комитет должен зафиксировать итоговое заключение.'}</p>
         {billConclusion&&<div className="billMaterialSummary"><b>{billConclusion.finalized?'Зафиксировано':'Черновик'}</b><span>{billConclusion.recommendation==='proceed'?'Рекомендовано продолжить процедуру':billConclusion.recommendation==='return'?'Рекомендовано вернуть на доработку':billConclusion.recommendation==='reject'?'Рекомендовано отклонить':'Итоговая рекомендация ещё не выбрана'}</span></div>}
        </div>
        <span className="billReadinessStepState">{billReadiness?.committee_ready?'Готово':'Требует решения'}</span>
       </article>}
      </div>

      <footer className="billReadinessFooter">
       <div><b>{billSubmissionReady?'Комплект для внесения сформирован':'Следующее действие'}</b><span>{billSubmissionReady?(showBillCommitteeReadiness&&!billReadiness?.committee_ready?'Ожидается заключение профильного комитета.':'Документ может двигаться дальше по процедуре.'):(billProfileReady?'Добавьте обязательные материалы.':'Заполните карточку внесения.')}</span></div>
       {canMaintainBillPackage&&<button type="button" className={billSubmissionReady?'secondary':'primary'} aria-expanded={billDossierOpen} onClick={()=>setBillDossierOpen(open=>!open)}><ClipboardList size={17}/>{billDossierOpen?'Закрыть редактирование':billSubmissionReady?'Изменить комплект':'Заполнить комплект'}</button>}
      </footer>

      {billDossierOpen&&<div className="billDossierEditor">
       <div className="billDossierEditorHead"><div><small>РЕДАКТИРОВАНИЕ КОМПЛЕКТА</small><h3>Карточка и приложения</h3></div><span>Изменения применяются к уже созданному НПА</span></div>
       <div className="billDossierLayout">
        <section className="billDossierCard"><div className="billDossierCardHead"><b>1. Карточка внесения</b><small>Комитет, представитель и параметры комплекта</small></div><div className="billProfileForm"><label><input type="checkbox" checked={billFinancial} onChange={e=>setBillFinancial(e.target.checked)}/> Требуется ФЭО</label><label><input type="checkbox" checked={billGovernmentOpinion} onChange={e=>setBillGovernmentOpinion(e.target.checked)}/> Требуется заключение Правительства</label><StyledSelect label="Профильный комитет" value={billCommittee} onChange={setBillCommittee} options={[{value:'',label:'Не выбран'},...committeeUnits.map(x=>({value:x.unit_key,label:x.title}))]}/><StyledSelect label="Представитель в ГД" value={billRepresentative} onChange={setBillRepresentative} options={[{value:'',label:'Не указан'},...members.filter(m=>m.kind==='student').map(m=>({value:m.user_id,label:m.full_name}))]}/><textarea rows={2} value={billNote} onChange={e=>setBillNote(e.target.value)} placeholder="Комментарий к внесению"/>{(selected.author_id===me?.user_id||teacher||selected.current_owner_key==='gd_staff'||selected.current_owner_key==='gd_council')&&<button className="secondary" disabled={busy} onClick={()=>void saveBillProfile()}>{busy?'Сохраняю…':'Сохранить карточку'}</button>}</div></section>
        <section className="billDossierCard"><div className="billDossierCardHead"><b>2. Обязательные материалы</b><small>Дозагрузка и проверка приложений</small></div><div className="billPackageList">{requiredBillKinds.map(kind=>{const bf=billFiles.find(x=>x.file_kind===kind);return <div key={kind} className={bf?.status||'missing'}><span>{bf?.status==='accepted'?'✓':bf?.status==='revision'?'↺':bf?'○':'—'}</span><div><b>{billFileLabels[kind]||kind}</b>{bf&&<a href={bf.url||'#'} target="_blank" rel="noreferrer">{bf.file_name}</a>}{bf?.note&&<small>{bf.note}</small>}</div>{bf&&canManage(selected)&&<div><input value={billReviewNote[bf.id]||''} onChange={e=>setBillReviewNote(v=>({...v,[bf.id]:e.target.value}))} placeholder="Комментарий"/><button onClick={()=>void reviewBillFile(bf.id,'accepted')}>Принять</button><button onClick={()=>void reviewBillFile(bf.id,'revision')}>Доработка</button></div>}</div>})}</div>{selected.author_id===me?.user_id&&selected.current_owner_key==='author'&&<div className="billPackageUpload"><StyledSelect label="Добавить материал" value={billFileKind} onChange={setBillFileKind} options={Object.entries(billFileLabels).map(([k,v])=>({value:k,label:v}))}/><label>{billFile?.name||'Выберите файл'}<input type="file" accept=".pdf,.doc,.docx,.txt" onChange={e=>setBillFile(e.target.files?.[0]||null)}/></label><button disabled={busy||!billFile} onClick={()=>void uploadBillFile()}>{busy?'Загрузка…':'Загрузить'}</button></div>}</section>
       </div>
       {(selected.status_code==='committee'||billConclusion)&&<section className="billCommitteeConclusion billDossierCard"><div className="billDossierCardHead"><b>3. Заключение профильного комитета</b><small>Заполняется после поступления законопроекта в комитет</small></div><StyledSelect label="Докладчик" value={committeeRapporteur} onChange={setCommitteeRapporteur} options={[{value:'',label:'Не выбран'},...members.filter(m=>m.kind==='student').map(m=>({value:m.user_id,label:m.full_name}))]}/><label>Соответствие Конституции, ФКЗ и ФЗ<textarea rows={3} value={committeeLegal} onChange={e=>setCommitteeLegal(e.target.value)}/></label><label>Внутренняя логика и противоречия<textarea rows={3} value={committeeLogic} onChange={e=>setCommitteeLogic(e.target.value)}/></label><label>Полнота перечня изменяемых актов<textarea rows={3} value={committeeActs} onChange={e=>setCommitteeActs(e.target.value)}/></label><StyledSelect label="Рекомендация" value={committeeRecommendation} onChange={v=>setCommitteeRecommendation(v as typeof committeeRecommendation)} options={[{value:'draft',label:'Черновик'},{value:'proceed',label:'Передать в Совет ГД'},{value:'return',label:'Вернуть субъекту инициативы'},{value:'reject',label:'Рекомендовать отклонить'}]}/>{canManage(selected)&&<div><button className="secondary" disabled={busy} onClick={()=>void saveCommitteeConclusion(false)}>Сохранить</button><button className="primary" disabled={busy||committeeRecommendation==='draft'} onClick={()=>void saveCommitteeConclusion(true)}>Зафиксировать заключение</button></div>}</section>}
      </div>}
     </section>}
    <details className="surface formalHistoryDisclosure"><summary className="formalHistorySummary"><div className="formalHistorySummaryMain"><div><small>ЖУРНАЛ ДЕЙСТВИЙ</small><h2>История изменений</h2></div><span className="formalHistoryCount">{history.length} записей</span></div><span className="formalHistoryChevron" aria-hidden="true"><ChevronDown size={18}/></span></summary><div className="formalHistoryBody"><div className="formalLinkedVotes">{votes.filter(v=>v.formal_document_id===selected.id).map(v=><button type="button" key={v.id} onClick={()=>onOpenVotes(v.id)}><b>{v.title}</b><span>{v.status==='open'?'Голосование открыто':v.result_label||'Голосование завершено'}</span></button>)}</div><div>{history.length?history.map(h=><div className="formalHistoryRow" key={h.id}><span/><div><time>{fmtDateTime(h.created_at)}</time><b>{h.action}</b><small>{h.actor_id?members.find(m=>m.user_id===h.actor_id)?.full_name||'Участник':'Система'}{h.note?' · '+h.note:''}</small></div></div>):<div className="emptyState">История пока пуста.</div>}</div></div></details>
    <CivicDiscussion key={selected.id} kind="document" targetId={selected.id} g={g} readOnly={readOnly}/>
    {revisions.length>0&&<details className="documentRevisionList"><summary>Предыдущие редакции · {revisions.length}</summary>{revisions.map(r=><article key={r.id}><div><b>Редакция {r.revision}</b><time>{fmtDateTime(r.created_at)}</time></div><h3>{r.title}</h3><details><summary>Показать текст редакции</summary><p>{r.body_text||'Текст отсутствует'}</p></details>{canEditSelected&&!editing&&<button type="button" className="secondary" onClick={()=>{setEditTitle(r.title);setEditBody(r.body_text||'');setEditNote('Восстановлен текст редакции '+r.revision);setEditRevision(Number(selected.metadata?.revision||1));setEditing(true)}}>Использовать текст в новой редакции</button>}</article>)}</details>}
   </>}</article>
  </section>}

  <section className="formalLawBase"><div><small>ПРАВОВЫЕ ОРИЕНТИРЫ</small><h2>Как устроена процедура</h2></div><div className="formalLawLinks"><a href="https://www.consultant.ru/document/cons_doc_LAW_28399/" target="_blank" rel="noreferrer"><b>Конституция РФ</b><span>Ст. 104–107 · законодательная инициатива и принятие законов ↗</span></a><a href="https://sozd.duma.gov.ru/" target="_blank" rel="noreferrer"><b>СОЗД Государственной Думы</b><span>Образцы и реальное движение законопроектов ↗</span></a><a href="https://publication.pravo.gov.ru/" target="_blank" rel="noreferrer"><b>Официальное опубликование</b><span>Официальные тексты принятых актов ↗</span></a></div></section>
 <a className="legalEmblemSources" href="/emblems/sources.json" target="_blank" rel="noreferrer">Источники эмблем и условия использования</a>
 </div>;
}
