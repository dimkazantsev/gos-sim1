'use client';
import {IconAction} from '../ui/IconAction';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import InstitutionEmblemImage from './InstitutionEmblemImage';
import {institutionEmblem} from './institutionEmblems';
import {extractCandidateDocumentText} from './candidateDocumentText';

type Settings={game_id:string;system_type:'relative'|'absolute'|'qualified'|'preferential';threshold_pct:number;poll_enabled:boolean;status:'setup'|'round1'|'runoff'|'finished'|'manual_required';result:Record<string,any>};
type Candidate={id:string;user_id:string|null;party_id:string|null;display_name:string;nomination_type:'party'|'self'|'fictional';registration_status:'submitted'|'registered'|'revision'|'rejected'|'withdrawn';program_summary:string|null;campaign_statement:string|null;registration_attempts:number;legal_error_count:number;rating_penalty:number;created_by:string;registration_number:string|null;registration_decision_no:string|null;registration_decision_at:string|null;registration_public_summary:string|null;cec_submitted_at:string|null;cec_submission_version:number;archived_at:string|null;photo_path:string|null};
type CecDecision={id:string;candidate_id:string;decision_type:'registered'|'revision'|'rejected'|'withdrawn';decision_number:string;public_summary:string;created_at:string;reasoning?:AutoReview|null};
type CecPrivateNote={decision_id:string;candidate_id:string;private_summary:string|null};
type PrivateProfile={candidate_id:string;birth_date:string|null;birth_place:string|null;contact_phone:string|null;contact_email:string|null;address_text:string|null;passport_note:string|null};
type ProgramPoint={id:string;candidate_id:string;point_no:number;body:string};
type CandidateDoc={id:string;candidate_id:string;doc_kind:string;title:string;storage_path:string;file_name:string;status:'submitted'|'accepted'|'revision';note:string|null;url?:string|null;extracted_text:string|null;extraction_status:'pending'|'extracted'|'no_text'|'unsupported'|'error';auto_check:{verdict?:'ok'|'issues'|'manual';summary?:string;issues?:string[];checks?:{label:string;ok:boolean}[];basis?:string};is_submitted:boolean;submitted_at:string|null;archived_at:string|null};
type Supporter={id:string;candidate_id:string;supporter_user_id:string};
type SignatureBatch={id:string;candidate_id:string;direction_label:string;signatures:number};
type CandidateReadiness={ready:boolean;issues:string[];program_points:number;accepted_documents:number;required_documents:number;support_group:number;signatures:number;nomination_type:string};
type AutoReviewItem={kind:string;title:string;state:string;verdict:'ok'|'issues'|'manual';summary?:string;issues?:string[];file_name?:string};
type AutoReview={ready:boolean;recommended_status:'registered'|'revision';error_count:number;manual_count:number;issues:string[];items:AutoReviewItem[];program_points:number;support_group:number;signatures:number;legal_basis:string[]};

const systemNames={relative:'Относительное большинство',absolute:'Абсолютное большинство',qualified:'Квалифицированное большинство',preferential:'Преференциальная'} as const;
const candidateStatus={submitted:'На проверке',registered:'Зарегистрирован',revision:'На доработке',rejected:'Отказано',withdrawn:'Снят'} as const;
const docLabels:Record<string,string>={
 party_decision:'Решение / протокол партии о выдвижении',
 party_egrul:'Свидетельство ЕГРЮЛ о регистрации партии',
 group_petition:'Ходатайство о регистрации группы избирателей',
 signature_sheets:'Подписные листы',
 consent:'Заявление о согласии баллотироваться',
 passport:'Копия паспорта с изменёнными персональными данными',
 income:'Сведения о доходах и их источниках',
 real_estate:'Сведения о недвижимом имуществе',
 expenses:'Сведения о расходах'
};
const partyDocs=['party_decision','party_egrul','consent','passport','income','real_estate','expenses'];
const selfDocs=['group_petition','signature_sheets','consent','passport','income','real_estate','expenses'];

export default function PresidentialElectionLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,parties,currentStage,setError}=g;
 const [settings,setSettings]=useState<Settings|null>(null);
 const [candidates,setCandidates]=useState<Candidate[]>([]);
 const [points,setPoints]=useState<ProgramPoint[]>([]);
 const [candidateDocs,setCandidateDocs]=useState<CandidateDoc[]>([]);
 const [supporters,setSupporters]=useState<Supporter[]>([]);
 const [signatureBatches,setSignatureBatches]=useState<SignatureBatch[]>([]);
 const [decisions,setDecisions]=useState<CecDecision[]>([]);
 const [privateNotes,setPrivateNotes]=useState<CecPrivateNote[]>([]);
 const [privateProfiles,setPrivateProfiles]=useState<Record<string,PrivateProfile>>({});
 const [privateDrafts,setPrivateDrafts]=useState<Record<string,PrivateProfile>>({});
 const [readiness,setReadiness]=useState<Record<string,CandidateReadiness>>({});
 const [autoReviews,setAutoReviews]=useState<Record<string,AutoReview>>({});
 const [docTextDraft,setDocTextDraft]=useState<Record<string,string>>({});
 const [photoUrls,setPhotoUrls]=useState<Record<string,string>>({});
 const [candidateUser,setCandidateUser]=useState('');
 const [candidateParty,setCandidateParty]=useState('');
 const [candidateName,setCandidateName]=useState('');
 const [program,setProgram]=useState('');
 const [campaign,setCampaign]=useState('');
 const [panelView,setPanelView]=useState<'application'|'decisions'|'candidates'|'dossier'>('dossier');
 const [documentPreview,setDocumentPreview]=useState<{kind:'decision'|'credential';candidateId:string;decisionId?:string}|null>(null);
 const [review,setReview]=useState<Record<string,{status:'registered'|'revision'|'rejected'|'withdrawn';errors:string;penalty:string;publicSummary:string;privateSummary:string}>>({});
 const [pointDraft,setPointDraft]=useState<Record<string,string>>({});
 const [supporterDraft,setSupporterDraft]=useState<Record<string,string>>({});
 const [directionDraft,setDirectionDraft]=useState<Record<string,string>>({});
 const [signatureDraft,setSignatureDraft]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const systemReady=!!settings;
 const canNominate=!!me&&systemReady&&(teacher||currentStage?.stage_no===6);

 async function load(){
  if(!game)return;
  const [a,b,p,d,sg,sb,cd,cn,pp]=await Promise.all([
   supabase.from('presidential_election_settings').select('*').eq('game_id',game.id).maybeSingle(),
   supabase.from('presidential_candidates').select('*').eq('game_id',game.id).is('archived_at',null).order('created_at'),
   supabase.from('presidential_candidate_program_points').select('*').eq('game_id',game.id).order('point_no'),
   supabase.from('presidential_candidate_documents').select('*').eq('game_id',game.id).is('archived_at',null).order('created_at'),
   supabase.from('presidential_support_group').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('presidential_signature_batches').select('*').eq('game_id',game.id).order('direction_label'),
   supabase.from('presidential_cec_decisions').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('presidential_cec_private_notes').select('*').eq('game_id',game.id).order('created_at',{ascending:false}),
   supabase.from('presidential_candidate_private_profiles').select('*').eq('game_id',game.id)
  ]);
  if(!a.error&&a.data)setSettings(a.data as Settings)
  if(!b.error){const rows=(b.data||[]) as Candidate[];setCandidates(rows);setReview(Object.fromEntries(rows.map(x=>[x.id,{status:x.registration_status==='registered'?'registered':x.registration_status==='rejected'?'rejected':x.registration_status==='withdrawn'?'withdrawn':'revision',errors:String(x.legal_error_count),penalty:String(x.rating_penalty),publicSummary:x.registration_public_summary||'',privateSummary:''}])));const pairs=await Promise.all(rows.filter(x=>x.photo_path).map(async x=>[x.id,(await supabase.storage.from('game-assets').createSignedUrl(x.photo_path!,3600)).data?.signedUrl||''] as const));setPhotoUrls(Object.fromEntries(pairs.filter(x=>x[1])))}
  if(!p.error)setPoints((p.data||[]) as ProgramPoint[]);
  if(!d.error){
   const docs=(d.data||[]) as CandidateDoc[];
   const withUrls=await Promise.all(docs.map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
   setCandidateDocs(withUrls);setDocTextDraft(v=>({...v,...Object.fromEntries(withUrls.map(x=>[x.id,x.extracted_text||'']))}));
  }
  if(!sg.error)setSupporters((sg.data||[]) as Supporter[]);
  if(!sb.error)setSignatureBatches((sb.data||[]) as SignatureBatch[]);
  if(!cd.error)setDecisions((cd.data||[]) as CecDecision[]);
  if(!cn.error)setPrivateNotes((cn.data||[]) as CecPrivateNote[]);
  if(!pp.error){const rows=(pp.data||[]) as PrivateProfile[];const map=Object.fromEntries(rows.map(x=>[x.candidate_id,x]));setPrivateProfiles(map);setPrivateDrafts(v=>({...v,...map}))}
  if(!b.error){
   const rr:Record<string,CandidateReadiness>={},ar:Record<string,AutoReview>={};
   await Promise.all(((b.data||[]) as Candidate[]).map(async x=>{
    const [q,audit]=await Promise.all([
     supabase.rpc('get_presidential_candidate_readiness',{p_candidate_id:x.id}),
     supabase.rpc('get_presidential_cec_auto_review',{p_candidate_id:x.id})
    ]);
    if(!q.error&&q.data)rr[x.id]=q.data as CandidateReadiness;
    if(!audit.error&&audit.data)ar[x.id]=audit.data as AutoReview;
   }));
   setReadiness(rr);setAutoReviews(ar);
  }
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('presidential-lab:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_election_settings',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_candidates',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_candidate_program_points',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_candidate_documents',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_support_group',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_signature_batches',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_cec_decisions',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const activeGame=game;
 const activeMe=me;
 const partyUsers=(partyId:string)=>{const p=parties.find(x=>x.id===partyId);return p?members.filter(m=>m.kind==='student'&&m.team===p.name):[]};

 async function nominate(){
  let type:'party'|'self'|'fictional'=teacher?(candidateParty?'party':candidateUser?'self':'fictional'):(ledParty?'party':'self');
  let partyId:string|null=teacher?(candidateParty||null):(ledParty?.id||null);
  let userId:string|null=teacher?(candidateUser||null):(ledParty?(candidateUser||activeMe.user_id):activeMe.user_id);
  const found=members.find(m=>m.user_id===userId);
  const name=(candidateName.trim()||found?.full_name||activeMe.full_name).trim();
  setBusy(true);const r=await supabase.rpc('save_presidential_candidate',{p_game_id:activeGame.id,p_candidate_id:null,p_user_id:userId,p_party_id:partyId,p_display_name:name,p_nomination_type:type,p_program_summary:program.trim()||null});
  if(r.error)setError(r.error.message);else{
   const candidateId=String(r.data||'');
   const programLines=program.split(/\n+/).map(x=>x.trim().replace(/^\d+[.)]\s*/,'' )).filter(Boolean).slice(0,50);
   for(let i=0;i<programLines.length;i++)await supabase.rpc('save_presidential_program_point',{p_candidate_id:candidateId,p_point_no:i+1,p_body:programLines[i]});
   if(candidateId)await supabase.rpc('save_presidential_public_profile',{p_candidate_id:candidateId,p_program_summary:program.trim()||null,p_campaign_statement:campaign.trim()||null});
   setCandidateName('');setCandidateUser('');setProgram('');setCampaign('');setPanelView('dossier');await load()
  }setBusy(false)
 }
 async function reviewCandidate(id:string){const x=review[id];if(!x)return;setBusy(true);const r=await supabase.rpc('record_presidential_cec_decision',{p_candidate_id:id,p_status:x.status,p_legal_errors:Number(x.errors)||0,p_rating_penalty:Number(x.penalty)||0,p_public_summary:x.publicSummary.trim()||null,p_private_summary:x.privateSummary.trim()||null});if(r.error)setError(r.error.message);else{setPanelView('decisions');await load()}setBusy(false)}
 async function savePrivateProfile(candidateId:string){const x=privateDrafts[candidateId]||{candidate_id:candidateId,birth_date:null,birth_place:null,contact_phone:null,contact_email:null,address_text:null,passport_note:null};setBusy(true);const r=await supabase.rpc('save_presidential_private_profile',{p_candidate_id:candidateId,p_birth_date:x.birth_date||null,p_birth_place:x.birth_place||null,p_contact_phone:x.contact_phone||null,p_contact_email:x.contact_email||null,p_address_text:x.address_text||null,p_passport_note:x.passport_note||null});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function addProgramPoint(candidateId:string){
  const body=(pointDraft[candidateId]||'').trim();if(body.length<5)return;
  const next=Math.max(0,...points.filter(x=>x.candidate_id===candidateId).map(x=>x.point_no))+1;
  setBusy(true);const r=await supabase.rpc('save_presidential_program_point',{p_candidate_id:candidateId,p_point_no:next,p_body:body});
  if(r.error)setError(r.error.message);else{setPointDraft(v=>({...v,[candidateId]:''}));await load()}setBusy(false);
 }
 async function deleteProgramPoint(id:string){setBusy(true);const r=await supabase.rpc('delete_presidential_program_point',{p_point_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function uploadCandidateDoc(candidateId:string,kind:string,file:File){
  if(!file||!kind)return;
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const storagePath=activeGame.id+'/presidential/'+candidateId+'/docs/'+crypto.randomUUID()+'.'+ext;
  setBusy(true);
  const up=await supabase.storage.from('game-assets').upload(storagePath,file,{contentType:file.type||'application/octet-stream'});
  if(up.error){setError(up.error.message);setBusy(false);return}
  const r=await supabase.rpc('add_presidential_candidate_document',{p_candidate_id:candidateId,p_doc_kind:kind,p_title:docLabels[kind]||file.name,p_storage_path:storagePath,p_file_name:file.name,p_mime_type:file.type||null,p_file_size:file.size});
  if(r.error){setError(r.error.message);setBusy(false);return}
  const documentId=String(r.data||'');
  const extracted=await extractCandidateDocumentText(file);
  if(documentId){
   const saved=await supabase.rpc('save_presidential_candidate_document_text',{p_document_id:documentId,p_text:extracted.text,p_extraction_status:extracted.status});
   if(saved.error)setError(saved.error.message);
  }
  await load();setBusy(false);
 }
 async function saveDocumentText(doc:CandidateDoc){
  setBusy(true);const text=(docTextDraft[doc.id]??doc.extracted_text??'').trim();
  const r=await supabase.rpc('save_presidential_candidate_document_text',{p_document_id:doc.id,p_text:text,p_extraction_status:text.length>=20?'extracted':'no_text'});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function archiveCandidateDocument(doc:CandidateDoc){
  if(!teacher||busy)return;
  if(typeof window!=='undefined'&&!window.confirm('Удалить документ «'+doc.file_name+'» из активного досье?'))return;
  setBusy(true);
  const r=await supabase.rpc('archive_presidential_candidate_document',{p_document_id:doc.id});
  if(r.error)setError(r.error.message);else await load();
  setBusy(false);
 }
 async function archiveCandidateRecord(candidate:Candidate){
  if(!teacher||busy)return;
  if(typeof window!=='undefined'&&!window.confirm('Удалить кандидата «'+candidate.display_name+'» из активного реестра ЦИК и досье?'))return;
  setBusy(true);
  const r=await supabase.rpc('archive_presidential_candidate',{p_candidate_id:candidate.id});
  if(r.error)setError(r.error.message);else await load();
  setBusy(false);
 }
 async function uploadCandidatePhoto(candidateId:string,file:File){
  if(!file.type.startsWith('image/')){setError('Нужно выбрать изображение кандидата.');return}
  const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
  const storagePath=activeGame.id+'/presidential/'+candidateId+'/photo-'+crypto.randomUUID()+'.'+ext;
  setBusy(true);
  const up=await supabase.storage.from('game-assets').upload(storagePath,file,{contentType:file.type||'image/jpeg'});
  if(up.error){setError(up.error.message);setBusy(false);return}
  const r=await supabase.rpc('set_presidential_candidate_photo',{p_candidate_id:candidateId,p_storage_path:storagePath});
  if(r.error){setError(r.error.message);await supabase.storage.from('game-assets').remove([storagePath])}else await load();
  setBusy(false);
 }
 async function submitToCec(candidateId:string){
  setBusy(true);const r=await supabase.rpc('submit_presidential_candidate_to_cec',{p_candidate_id:candidateId});
  if(r.error)setError(r.error.message);else{setPanelView('application');await load()}setBusy(false);
 }
 function fillSuggestedDecision(id:string){
  const audit=autoReviews[id];if(!audit)return;
  const status:'registered'|'revision'=audit.error_count>0?'revision':'registered';
  const listed=audit.items.map((item,i)=>String(i+1)+'. '+item.title+' — '+(item.verdict==='ok'?'предварительно соответствует':item.verdict==='manual'?'требует ручной проверки':'есть замечания')+(item.issues?.length?': '+item.issues.join('; '):'')+'.').join('\n');
  const resolution=status==='registered'
   ?'Представленный комплект документов проверен. По результатам автоматической предварительной проверки существенные несоответствия не выявлены. Окончательное решение принимает ЦИК.'
   :'В представленном комплекте выявлены замечания. Документы подлежат доработке либо дополнительной ручной проверке до принятия окончательного решения ЦИК.';
  setReview(v=>({...v,[id]:{...(v[id]||{errors:'0',penalty:'0',publicSummary:'',privateSummary:''}),status,errors:String(audit.error_count),publicSummary:resolution,privateSummary:listed}}));
 }
 async function reviewCandidateDoc(id:string,status:'accepted'|'revision'){
  setBusy(true);const r=await supabase.rpc('review_presidential_candidate_document',{p_document_id:id,p_status:status,p_note:null});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function addSupporter(candidateId:string){
  const uid=supporterDraft[candidateId];if(!uid)return;setBusy(true);const r=await supabase.rpc('add_presidential_supporter',{p_candidate_id:candidateId,p_supporter_user_id:uid});
  if(r.error)setError(r.error.message);else{setSupporterDraft(v=>({...v,[candidateId]:''}));await load()}setBusy(false);
 }
 async function removeSupporter(id:string){setBusy(true);const r=await supabase.rpc('remove_presidential_supporter',{p_support_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function saveSignatureBatch(candidateId:string){
  const direction=(directionDraft[candidateId]||'').trim(),count=Math.max(0,Math.min(5,Number(signatureDraft[candidateId])||0));if(direction.length<2)return;
  setBusy(true);const r=await supabase.rpc('set_presidential_signature_batch',{p_candidate_id:candidateId,p_direction_label:direction,p_signatures:count});
  if(r.error)setError(r.error.message);else{setDirectionDraft(v=>({...v,[candidateId]:''}));setSignatureDraft(v=>({...v,[candidateId]:''}));await load()}setBusy(false);
 }

 return <section className="electionLab cecWorkspace">
  <header className="electionLabHead cecHead"><div><small>ЦИК РФ · ЭТАП 6</small><h2>Регистрация кандидатов в Президенты</h2><p>После определения Государственной Думой типа избирательной системы кандидаты формируют досье и подают документы в ЦИК. Агитация, голосование и подсчёт результатов начинаются на 7-м этапе.</p></div><div className="cecHeadSide"><InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="ЦИК РФ" className="cecEmblem" width={72} height={72}/><div><b>Центральная избирательная комиссия</b><span>Регистрация кандидатов</span></div></div></header>
  <nav className="cecTabs" aria-label="Разделы президентских выборов"><button className={panelView==='dossier'?'active':''} onClick={()=>setPanelView('dossier')}>Моё досье</button><button className={panelView==='application'?'active':''} onClick={()=>setPanelView('application')}>Подача в ЦИК <b>{candidates.filter(x=>x.cec_submitted_at&&x.registration_status==='submitted').length}</b></button><button className={panelView==='candidates'?'active':''} onClick={()=>setPanelView('candidates')}>Кандидаты <b>{candidates.filter(x=>x.cec_submitted_at).length}</b></button><button className={panelView==='decisions'?'active':''} onClick={()=>setPanelView('decisions')}>Решения ЦИК <b>{decisions.length}</b></button></nav>

  <div className="electionSettings electionSettingsReadOnly"><div><small>ДЕЙСТВУЮЩАЯ СИСТЕМА</small><strong>{settings?systemNames[settings.system_type]:'Не определена Государственной Думой'}</strong><span>{!settings?'Сначала примите поправку к ФЗ № 19-ФЗ на заседании ГД ФС РФ. До этого подача документов в ЦИК закрыта.':settings.system_type==='qualified'?'Установленный порог: '+settings.threshold_pct+'%':settings.system_type==='preferential'?'Порядок подсчёта определяется принятым решением ГД':settings.poll_enabled===false?'Соцопрос не используется':'Соцопрос включён в модель рейтинга'}</span></div><div className="electionSystemSource"><small>ИСТОЧНИК</small><b>Решение Государственной Думы</b><span>Изменяется только через парламентскую процедуру выше.</span></div></div>
  {!systemReady&&<div className="cecSystemGate"><b>Сначала — решение Государственной Думы</b><span>Выдвижение и подача регистрационного пакета в ЦИК станут доступны только после утверждения типа избирательной системы.</span></div>}

  {panelView==='dossier'&&canNominate&&candidates.filter(c=>c.user_id===activeMe.user_id||c.created_by===activeMe.user_id||(!!ledParty&&c.party_id===ledParty.id)).length===0&&<details className="candidateNomination" open><summary><div><b>Выдвинуть кандидата</b><span>Партия может иметь одного активного кандидата.</span></div><i>+</i></summary><div className="candidateNominationBody">{teacher&&<label>Партия<select value={candidateParty} onChange={e=>{setCandidateParty(e.target.value);setCandidateUser('')}}><option value="">Самовыдвижение / сценарный кандидат</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<label>Участник<select value={candidateUser} onChange={e=>setCandidateUser(e.target.value)}><option value="">{teacher?'Не привязывать к участнику':ledParty?'Выберите члена партии':'Я сам'}</option>{(teacher?(candidateParty?partyUsers(candidateParty):members.filter(m=>m.kind==='student')):ledParty?partyUsers(ledParty.id):[]).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>{teacher&&<label>Имя в бюллетене<input value={candidateName} onChange={e=>setCandidateName(e.target.value)} placeholder="Для вымышленного кандидата обязательно"/></label>}<label className="candidateProgram">Программа кандидата · один пункт с новой строки<textarea rows={7} value={program} onChange={e=>setProgram(e.target.value)} placeholder={"1. Положение программы\n2. Положение программы\n…\n10. Положение программы"}/></label><label className="candidateProgram">Публичный агитационный тезис<textarea rows={3} value={campaign} onChange={e=>setCampaign(e.target.value)} placeholder="Короткий публичный тезис кандидата"/></label><button className="primary" disabled={busy||(!teacher&&!!ledParty&&!candidateUser)} onClick={()=>void nominate()} >Создать черновик досье</button></div></details>}

  {panelView==='decisions'&&<section className="cecDecisionRegistry"><header><div><small>ПУБЛИЧНЫЙ РЕЕСТР</small><h3>Решения ЦИК РФ</h3></div><span>{decisions.length} решений</span></header>{decisions.length===0?<div className="emptyState">Решения ещё не принимались.</div>:decisions.map(x=>{const c=candidates.find(v=>v.id===x.candidate_id);const note=privateNotes.find(v=>v.decision_id===x.id);return <article key={x.id} className={'cecDecision '+x.decision_type}><div><small>{x.decision_number} · {new Date(x.created_at).toLocaleString('ru-RU')}</small><h4>{c?.display_name||'Кандидат'}</h4><p>{x.public_summary}</p>{x.reasoning?.items?.length&&<div className="cecDecisionChecks"><span>Проверено документов: <b>{x.reasoning.items.length}</b></span><span>Замечаний: <b>{x.reasoning.error_count||0}</b></span></div>}{note?.private_summary&&<details><summary>Служебное примечание ЦИК</summary><p>{note.private_summary}</p></details>}<button className="cecDocumentOpen" onClick={()=>setDocumentPreview({kind:'decision',candidateId:x.candidate_id,decisionId:x.id})}>Открыть решение ЦИК</button></div><strong>{candidateStatus[x.decision_type]}</strong></article>})}</section>}

  {systemReady&&(panelView==='candidates'||panelView==='dossier'||panelView==='application')&&<div className="candidateGrid">{candidates.length===0?<div className="emptyState">Кандидаты ещё не выдвинуты.</div>:candidates.filter(c=>panelView==='candidates'?!!c.cec_submitted_at:panelView==='application'?(teacher?!!c.cec_submitted_at:(c.user_id===activeMe.user_id||c.created_by===activeMe.user_id||(!!ledParty&&c.party_id===ledParty.id))):(c.user_id===activeMe.user_id||c.created_by===activeMe.user_id||(!!ledParty&&c.party_id===ledParty.id))).map(c=>{
    const party=parties.find(p=>p.id===c.party_id);
   const candidatePoints=points.filter(x=>x.candidate_id===c.id).sort((a,b)=>a.point_no-b.point_no);
   const docs=candidateDocs.filter(x=>x.candidate_id===c.id);
   const group=supporters.filter(x=>x.candidate_id===c.id);
   const sigs=signatureBatches.filter(x=>x.candidate_id===c.id);
   const ready=readiness[c.id];
   const canManage=teacher||c.user_id===activeMe.user_id||c.created_by===activeMe.user_id||(!!ledParty&&c.party_id===ledParty.id);
   const requiredKinds=c.nomination_type==='party'?partyDocs:c.nomination_type==='self'?selfDocs:[];
   const usedSupporterIds=new Set(supporters.filter(x=>x.candidate_id!==c.id).map(x=>x.supporter_user_id));
   return <article className={'candidateCard '+c.registration_status} key={c.id}><header><div className="candidateAvatar">{c.display_name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()}</div><div><small>{party?.name||(c.nomination_type==='self'?'Самовыдвижение':'Сценарный кандидат')}</small><h3>{c.display_name}</h3></div><div className="candidateHeaderActions"><span>{candidateStatus[c.registration_status]}</span>{teacher&&<IconAction variant="remove" onClick={()=>void archiveCandidateRecord(c)} label={'Удалить кандидата '+c.display_name}/>}</div></header>{c.registration_decision_no&&<div className="cecCandidateDecision"><b>{c.registration_decision_no}</b><span>{c.registration_public_summary||'Решение ЦИК зафиксировано.'}</span>{c.registration_number&&<button className="cecCredentialOpen" onClick={()=>setDocumentPreview({kind:'credential',candidateId:c.id})}>Удостоверение {c.registration_number}</button>}</div>}{panelView!=='application'&&c.program_summary&&<p className="candidateProgramText">{c.program_summary}</p>}{panelView!=='application'&&c.campaign_statement&&<p className="candidateCampaignText"><b>Агитационный тезис</b>{c.campaign_statement}</p>}<div className="candidateAudit"><span>Подач <b>{c.registration_attempts}</b></span><span>Юр. ошибок <b>{c.legal_error_count}</b></span><span>Штраф <b>−{Number(c.rating_penalty).toFixed(1)} п.п.</b></span></div>
   {panelView==='application'&&<section className="cecSubmissionPanel">
    <header><div><small>ПАКЕТ К РАССМОТРЕНИЮ</small><h4>{c.display_name}</h4></div><span className={c.cec_submitted_at?'submitted':'draft'}>{c.cec_submitted_at?'Подан в ЦИК':'Не подан'}</span></header>
    <div className="cecSubmissionProgress"><span><b>{docs.filter(x=>requiredKinds.includes(x.doc_kind)).length}</b> / {requiredKinds.length} документов</span><span><b>{candidatePoints.length}</b> / 10 пунктов программы</span>{c.nomination_type==='self'&&<><span><b>{group.length}</b> / 5 группа</span><span><b>{sigs.reduce((a,x)=>a+Number(x.signatures),0)}</b> / 15 подписей</span></>}</div>
    {autoReviews[c.id]&&<div className="cecAutoReview"><div className="cecAutoReviewHead"><div><b>Автоматическая предварительная проверка</b><small>ФЗ № 19-ФЗ · формы ЦИК · правила этапа 6</small></div><strong className={autoReviews[c.id].error_count?'issues':'ok'}>{autoReviews[c.id].error_count?autoReviews[c.id].error_count+' замечаний':'Комплект без явных ошибок'}</strong></div><ol>{autoReviews[c.id].items.map(item=><li key={item.kind} className={item.verdict}><span>{item.verdict==='ok'?'✓':item.verdict==='issues'?'!':'○'}</span><div><b>{item.title}</b><small>{item.summary||'Нет результата проверки.'}</small>{!!item.issues?.length&&<p>{item.issues.join(' · ')}</p>}</div></li>)}</ol></div>}
    {!teacher&&!c.cec_submitted_at&&<button type="button" className="primary cecSubmitPackage" disabled={busy||!c.photo_path||docs.filter(x=>requiredKinds.includes(x.doc_kind)).length<requiredKinds.length||candidatePoints.length<10||(c.nomination_type==='self'&&(group.length<5||sigs.reduce((a,x)=>a+Number(x.signatures),0)<15))} onClick={()=>void submitToCec(c.id)}>Подать пакет в ЦИК</button>}
    {!teacher&&c.cec_submitted_at&&c.registration_status==='revision'&&<button type="button" className="primary cecSubmitPackage" disabled={busy||!c.photo_path||docs.filter(x=>requiredKinds.includes(x.doc_kind)).length<requiredKinds.length} onClick={()=>void submitToCec(c.id)}>Подать исправленный пакет повторно</button>}
    {!teacher&&c.cec_submitted_at&&<p className="cecSubmittedNote">Версия подачи № {c.cec_submission_version} · {new Date(c.cec_submitted_at).toLocaleString('ru-RU')}</p>}
    {teacher&&autoReviews[c.id]&&<button type="button" className="secondary cecUseAutoReview" onClick={()=>fillSuggestedDecision(c.id)}>Сформировать проект решения по проверке</button>}
   </section>}
   {panelView==='dossier'&&canManage&&c.nomination_type!=='fictional'&&<details className="candidateDossier" open>
    <summary><div><b>Моё досье</b><span>{c.photo_path&&autoReviews[c.id]?.error_count===0&&docs.length>=requiredKinds.length&&candidatePoints.length>=10?'✓ черновик готов к подаче':'Заполните фото, документы и проверьте замечания'}</span></div><strong>{candidatePoints.length}/10 · {docs.filter(x=>requiredKinds.includes(x.doc_kind)).length}/{requiredKinds.length}</strong></summary>
    <div className="candidateDossierBody">
      <section className="candidatePhotoBlock"><header><div><small>ФОТО КАНДИДАТА</small><h4>Обязательное фото для бюллетеня и результатов</h4></div><span>{c.photo_path?'✓ загружено':'не загружено'}</span></header><div className="candidatePhotoUpload">{photoUrls[c.id]?<img src={photoUrls[c.id]} alt={c.display_name}/>:<div className="candidatePhotoFallback">{c.display_name.slice(0,1)}</div>}<label><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||c.registration_status==='registered'} onChange={e=>{const file=e.target.files?.[0];if(file)void uploadCandidatePhoto(c.id,file);e.target.value=''}}/><b>{c.photo_path?'Заменить фото':'Загрузить фото'}</b><span>JPG, PNG или WEBP. Без фотографии пакет нельзя передать в ЦИК.</span></label></div></section>
      <section className="candidateProgramPoints"><header><div><small>ПРОГРАММА</small><h4>Минимум 10 положений</h4></div><span>{candidatePoints.length}/10</span></header><div>{candidatePoints.map(x=><p key={x.id}><b>{x.point_no}.</b><span>{x.body}</span>{canManage&&c.registration_status!=='registered'&&<IconAction variant="remove" onClick={()=>void deleteProgramPoint(x.id)} label={'Удалить положение программы № '+x.point_no}/>}</p>)}</div>{canManage&&c.registration_status!=='registered'&&<div className="candidatePointComposer"><input value={pointDraft[c.id]||''} onChange={e=>setPointDraft(v=>({...v,[c.id]:e.target.value}))} placeholder="Следующее положение программы"/><button disabled={busy||(pointDraft[c.id]||'').trim().length<5} onClick={()=>void addProgramPoint(c.id)}>＋ Добавить</button></div>}</section>
     <section className="candidateDocPack cecDraftDocuments"><header><div><small>ДОКУМЕНТЫ ДЕЛА</small><h4>{c.nomination_type==='party'?'Партийное выдвижение':'Самовыдвижение'}</h4><p>Нажмите на нужный пункт, чтобы загрузить или заменить файл. После загрузки система извлечёт текст и выполнит предварительную проверку.</p></div><span>{docs.filter(x=>requiredKinds.includes(x.doc_kind)).length}/{requiredKinds.length}</span></header>
      <div className="candidateDocRows cecDocumentChecklist">{requiredKinds.map((kind,index)=>{const doc=docs.find(x=>x.doc_kind===kind);const verdict=doc?.auto_check?.verdict||'manual';const state=!doc?'missing':verdict==='ok'?'ok':verdict==='issues'?'issues':'manual';return <article key={kind} className={'cecDocumentItem '+state}>
       <label className="cecDocumentUploadTarget">
        <input type="file" accept=".pdf,.doc,.docx,.txt,image/jpeg,image/png,image/webp" disabled={busy||c.registration_status==='registered'} onChange={e=>{const file=e.target.files?.[0];if(file)void uploadCandidateDoc(c.id,kind,file);e.target.value=''}}/>
        <span className="cecDocumentState" aria-hidden="true">{!doc?index+1:state==='ok'?'✓':state==='issues'?'!':'○'}</span>
        <span className="cecDocumentCopy"><b>{docLabels[kind]}</b><small>{!doc?'Файл ещё не загружен':state==='ok'?'Предварительная проверка пройдена':state==='issues'?'Есть замечания':'Нужна ручная проверка текста'}</small></span>
        <strong>{!doc?'Загрузить':'Заменить'}</strong>
       </label>
       {doc&&<div className="cecDocumentDetails">
        <div className="cecDocumentFileLine"><a href={doc.url||'#'} target="_blank" rel="noreferrer">{doc.file_name}</a><span>{doc.is_submitted?'Передан в ЦИК':'Черновик'}</span>{teacher&&<IconAction variant="remove" onClick={()=>void archiveCandidateDocument(doc)} label={'Удалить документ '+doc.file_name}/>}</div>
        {doc.auto_check?.summary&&<p className={'cecAutoSummary '+state}>{doc.auto_check.summary}</p>}
        {!!doc.auto_check?.issues?.length&&<ul>{doc.auto_check.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
        <details className="cecRecognizedText"><summary>{doc.extracted_text?'Распознанный текст и редактирование':'Добавить текст для проверки'}</summary>
         <textarea rows={8} value={docTextDraft[doc.id]??doc.extracted_text??''} onChange={e=>setDocTextDraft(v=>({...v,[doc.id]:e.target.value}))} placeholder="Проверьте распознанный текст или вставьте его вручную. Именно этот текст используется для предварительной автоматической проверки."/>
         <div><small>{doc.extraction_status==='extracted'?'Текст распознан':doc.extraction_status==='no_text'?'Текстовый слой не найден':doc.extraction_status==='unsupported'?'Нужно добавить текст вручную':doc.extraction_status==='error'?'Ошибка извлечения':'Ожидает анализа'}</small><button type="button" disabled={busy} onClick={()=>void saveDocumentText(doc)}>Сохранить текст и перепроверить</button></div>
        </details>
       </div>}
      </article>})}</div>
     </section>
     <section className="candidatePrivateProfile"><header><div><small>ЗАКРЫТАЯ АНКЕТА</small><h4>Персональные сведения кандидата</h4></div><span>Не публикуется</span></header><div className="candidatePrivateGrid"><label>Дата рождения<input type="date" value={privateDrafts[c.id]?.birth_date||''} onChange={e=>setPrivateDrafts(v=>({...v,[c.id]:{...(v[c.id]||{candidate_id:c.id}),birth_date:e.target.value||null} as PrivateProfile}))}/></label><label>Место рождения<input value={privateDrafts[c.id]?.birth_place||''} onChange={e=>setPrivateDrafts(v=>({...v,[c.id]:{...(v[c.id]||{candidate_id:c.id}),birth_place:e.target.value} as PrivateProfile}))}/></label><label>Телефон<input value={privateDrafts[c.id]?.contact_phone||''} onChange={e=>setPrivateDrafts(v=>({...v,[c.id]:{...(v[c.id]||{candidate_id:c.id}),contact_phone:e.target.value} as PrivateProfile}))}/></label><label>E-mail<input type="email" value={privateDrafts[c.id]?.contact_email||''} onChange={e=>setPrivateDrafts(v=>({...v,[c.id]:{...(v[c.id]||{candidate_id:c.id}),contact_email:e.target.value} as PrivateProfile}))}/></label><label className="wide">Адрес / игровая контактная информация<textarea rows={2} value={privateDrafts[c.id]?.address_text||''} onChange={e=>setPrivateDrafts(v=>({...v,[c.id]:{...(v[c.id]||{candidate_id:c.id}),address_text:e.target.value} as PrivateProfile}))}/></label><label className="wide">Примечание к обезличенной копии паспорта<textarea rows={2} value={privateDrafts[c.id]?.passport_note||''} onChange={e=>setPrivateDrafts(v=>({...v,[c.id]:{...(v[c.id]||{candidate_id:c.id}),passport_note:e.target.value} as PrivateProfile}))}/></label></div><button disabled={busy} onClick={()=>void savePrivateProfile(c.id)}>Сохранить закрытую анкету</button></section>
     {c.nomination_type==='self'&&<section className="candidateSelfSupport"><header><div><small>САМОВЫДВИЖЕНИЕ</small><h4>Группа поддержки и подписи</h4></div><span>{group.length}/5 · {sigs.reduce((a,x)=>a+Number(x.signatures),0)}/15</span></header><div className="supportGroupList">{group.map(x=><div key={x.id}><b>{members.find(m=>m.user_id===x.supporter_user_id)?.full_name||'Участник'}</b>{canManage&&c.registration_status!=='registered'&&<IconAction variant="remove" onClick={()=>void removeSupporter(x.id)} label="Исключить участника из группы поддержки"/>}</div>)}</div>{canManage&&c.registration_status!=='registered'&&<div className="supportComposer"><select value={supporterDraft[c.id]||''} onChange={e=>setSupporterDraft(v=>({...v,[c.id]:e.target.value}))}><option value="">Добавить в группу поддержки…</option>{members.filter(m=>m.kind==='student'&&!usedSupporterIds.has(m.user_id)&&!group.some(x=>x.supporter_user_id===m.user_id)).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.group_name||'без направления'}</option>)}</select><button disabled={busy||!supporterDraft[c.id]} onClick={()=>void addSupporter(c.id)}>Добавить</button></div>}<div className="signatureBatchList">{sigs.map(x=><div key={x.id}><b>{x.direction_label}</b><span>{x.signatures}/5 подписей</span></div>)}</div>{canManage&&c.registration_status!=='registered'&&<div className="signatureComposer"><input value={directionDraft[c.id]||''} onChange={e=>setDirectionDraft(v=>({...v,[c.id]:e.target.value}))} placeholder="Направление ИГН"/><input type="number" min="0" max="5" value={signatureDraft[c.id]||''} onChange={e=>setSignatureDraft(v=>({...v,[c.id]:e.target.value}))} placeholder="0–5"/><button disabled={busy||(directionDraft[c.id]||'').trim().length<2} onClick={()=>void saveSignatureBatch(c.id)}>Записать подписи</button></div>}<p className="candidatePrivacyNote">В системе хранится только количество подписей по направлениям. Ф.И.О., даты рождения и реальные паспортные данные не нужны.</p></section>}
     {autoReviews[c.id]&&<div className={'cecDraftAudit '+(autoReviews[c.id].error_count?'hasIssues':'isReady')}><b>{autoReviews[c.id].error_count?'Предварительная проверка нашла замечания':'Предварительная проверка комплекта пройдена'}</b><span>{autoReviews[c.id].error_count} замечаний · {autoReviews[c.id].manual_count} пунктов требуют ручной проверки ЦИК</span>{!!autoReviews[c.id].issues?.length&&<ul>{autoReviews[c.id].issues.map(x=><li key={x}>{x}</li>)}</ul>}<small>Автоматическая проверка — учебная подсказка, а не юридическое заключение. Окончательное решение принимает преподаватель в роли ЦИК.</small></div>}
    </div>
   </details>}
   {panelView==='application'&&teacher&&c.cec_submitted_at&&<div className="candidateReview cecReview"><select value={review[c.id]?.status||'revision'} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{errors:'0',penalty:'0',publicSummary:'',privateSummary:''}),status:e.target.value as 'registered'|'revision'|'rejected'|'withdrawn'}}))}><option value="registered">Зарегистрировать</option><option value="revision">На доработку</option><option value="rejected">Отказать</option><option value="withdrawn">Снять</option></select><label>Число юридических ошибок<input type="number" min="0" value={review[c.id]?.errors||'0'} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{status:'revision',penalty:'0',publicSummary:'',privateSummary:''}),errors:e.target.value}}))}/></label><label>Штраф к рейтингу, п.п.<input type="number" min="0" step="0.1" value={review[c.id]?.penalty||'0'} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{status:'revision',errors:'0',publicSummary:'',privateSummary:''}),penalty:e.target.value}}))}/></label><label className="cecReviewPublic">Резолютивная часть<textarea rows={2} value={review[c.id]?.publicSummary||''} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{status:'revision',errors:'0',penalty:'0',privateSummary:''}),publicSummary:e.target.value}}))}/></label><label className="cecReviewPrivate">Мотивировка и замечания<textarea rows={2} value={review[c.id]?.privateSummary||''} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{status:'revision',errors:'0',penalty:'0',publicSummary:''}),privateSummary:e.target.value}}))}/></label><button disabled={busy} onClick={()=>void reviewCandidate(c.id)}>Выпустить решение ЦИК</button></div>}
   </article>
  })}</div>}

  {documentPreview&&(()=>{const c=candidates.find(x=>x.id===documentPreview.candidateId);const d=documentPreview.decisionId?decisions.find(x=>x.id===documentPreview.decisionId):decisions.find(x=>x.candidate_id===documentPreview.candidateId&&x.decision_type==='registered');if(!c)return null;return <div className="cecDocumentModal" role="dialog" aria-modal="true" aria-label={documentPreview.kind==='decision'?'Решение ЦИК':'Удостоверение кандидата'}><div className="cecDocumentBackdrop" onClick={()=>setDocumentPreview(null)}/><div className="cecDocumentShell"><div className="cecDocumentTools"><b>{documentPreview.kind==='decision'?'Решение ЦИК РФ':'Удостоверение кандидата'}</b><span/><button onClick={()=>window.print()}>Печать / PDF</button><button onClick={()=>setDocumentPreview(null)}>Закрыть</button></div>{documentPreview.kind==='decision'?<article className="cecPrintableDocument cecDecisionSheet"><header><InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="Герб Российской Федерации" width={64} height={64}/><div><b>ЦЕНТРАЛЬНАЯ ИЗБИРАТЕЛЬНАЯ КОМИССИЯ<br/>РОССИЙСКОЙ ФЕДЕРАЦИИ</b><span>Учебная редуцированная модель GOS//SIMS</span></div></header><div className="cecDecisionMeta"><span>Решение № <b>{d?.decision_number||c.registration_decision_no||'—'}</b></span><span>{new Date(d?.created_at||c.registration_decision_at||Date.now()).toLocaleDateString('ru-RU')}</span></div><h3>{d?.decision_type==='registered'?'О регистрации кандидата':d?.decision_type==='rejected'?'Об отказе в регистрации кандидата':d?.decision_type==='withdrawn'?'О снятии кандидата':'О возврате документов на доработку'}</h3><p>Центральная избирательная комиссия Российской Федерации в рамках учебной модели рассмотрела материалы кандидата <b>{c.display_name}</b>{c.party_id?' и представленные материалы политической партии':''}. Проверка проводится с учётом главы V Федерального закона № 19-ФЗ, форм документов ЦИК и специальных редуцированных правил этапа 6 GOS//SIMS.</p>{d?.reasoning?.items?.length&&<section className="cecDecisionReasoning"><h4>Результаты проверки представленных документов</h4><ol>{d.reasoning.items.map((item,index)=><li key={item.kind}><b>{item.title}</b><span>{item.verdict==='ok'?'соответствует по результатам предварительной проверки':item.verdict==='manual'?'требует ручной проверки':'не соответствует / имеются замечания'}</span>{!!item.issues?.length&&<p>{item.issues.join('; ')}</p>}</li>)}</ol>{d.reasoning.issues?.length>0&&<p className="cecDecisionReasoningSummary">Дополнительно: {d.reasoning.issues.join(' ')}</p>}</section>}<div className="cecResolution"><small>ПОСТАНОВИЛА</small><strong>{d?.public_summary||c.registration_public_summary||'Решение зафиксировано в системе.'}</strong></div><footer><span>Председатель Центральной избирательной комиссии Российской Федерации</span><b>________________</b></footer></article>:<article className="cecPrintableDocument cecCredentialSheet"><div className="cecCredentialCover"><InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="Герб Российской Федерации" width={58} height={58}/><b>РОССИЙСКАЯ<br/>ФЕДЕРАЦИЯ</b><small>УЧЕБНОЕ УДОСТОВЕРЕНИЕ</small></div><div className="cecCredentialInside"><section><InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="Герб Российской Федерации" width={44} height={44}/><b>Центральная избирательная комиссия Российской Федерации</b><strong>УДОСТОВЕРЕНИЕ</strong><span>{c.registration_number||'—'}</span><small>г. Москва · {c.registration_decision_at?new Date(c.registration_decision_at).toLocaleDateString('ru-RU'):'дата регистрации не указана'}</small></section><section><small>Выборы Президента Российской Федерации · учебная модель</small><h3>{c.display_name}</h3><p>зарегистрирован(а) кандидатом на должность Президента Российской Федерации</p><b>{c.registration_decision_at?new Date(c.registration_decision_at).toLocaleDateString('ru-RU'):'—'}</b><footer>Председатель ЦИК РФ ____________</footer></section></div></article>}</div></div>})()}
  </section>;
}
