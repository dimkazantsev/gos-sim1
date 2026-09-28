'use client';
import {IconAction} from '../ui/IconAction';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Settings={game_id:string;system_type:'relative'|'absolute'|'qualified'|'preferential';threshold_pct:number;poll_enabled:boolean;status:'setup'|'round1'|'runoff'|'finished'|'manual_required';result:Record<string,any>};
type Candidate={id:string;user_id:string|null;party_id:string|null;display_name:string;nomination_type:'party'|'self'|'fictional';registration_status:'submitted'|'registered'|'revision'|'rejected'|'withdrawn';program_summary:string|null;registration_attempts:number;legal_error_count:number;rating_penalty:number;created_by:string};
type ProgramPoint={id:string;candidate_id:string;point_no:number;body:string};
type CandidateDoc={id:string;candidate_id:string;doc_kind:string;title:string;storage_path:string;file_name:string;status:'submitted'|'accepted'|'revision';note:string|null;url?:string|null};
type Supporter={id:string;candidate_id:string;supporter_user_id:string};
type SignatureBatch={id:string;candidate_id:string;direction_label:string;signatures:number};
type CandidateReadiness={ready:boolean;issues:string[];program_points:number;accepted_documents:number;required_documents:number;support_group:number;signatures:number;nomination_type:string};
type Score={candidate_id:string;round_no:1|2;teacher_program_pct:number|null;teacher_campaign_pct:number|null;game_rating_pct:number|null;poll_pct:number|null;teacher_runoff_pct:number|null;computed_pct:number|null};
type Draft={program:string;campaign:string;rating:string;poll:string;runoff:string};

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
const emptyDraft=():Draft=>({program:'',campaign:'',rating:'',poll:'',runoff:''});

export default function PresidentialElectionLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,parties,currentStage,setError}=g;
 const [settings,setSettings]=useState<Settings|null>(null);
 const [candidates,setCandidates]=useState<Candidate[]>([]);
 const [scores,setScores]=useState<Score[]>([]);
 const [points,setPoints]=useState<ProgramPoint[]>([]);
 const [candidateDocs,setCandidateDocs]=useState<CandidateDoc[]>([]);
 const [supporters,setSupporters]=useState<Supporter[]>([]);
 const [signatureBatches,setSignatureBatches]=useState<SignatureBatch[]>([]);
 const [readiness,setReadiness]=useState<Record<string,CandidateReadiness>>({});
 const [system,setSystem]=useState<Settings['system_type']>('absolute');
 const [threshold,setThreshold]=useState(50);
 const [pollEnabled,setPollEnabled]=useState(true);
 const [candidateUser,setCandidateUser]=useState('');
 const [candidateParty,setCandidateParty]=useState('');
 const [candidateName,setCandidateName]=useState('');
 const [program,setProgram]=useState('');
 const [review,setReview]=useState<Record<string,{status:Candidate['registration_status'];errors:string;penalty:string}>>({});
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [pointDraft,setPointDraft]=useState<Record<string,string>>({});
 const [docKindDraft,setDocKindDraft]=useState<Record<string,string>>({});
 const [docFileDraft,setDocFileDraft]=useState<Record<string,File|null>>({});
 const [supporterDraft,setSupporterDraft]=useState<Record<string,string>>({});
 const [directionDraft,setDirectionDraft]=useState<Record<string,string>>({});
 const [signatureDraft,setSignatureDraft]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const canNominate=!!me&&(teacher||currentStage?.stage_no===6);

 async function load(){
  if(!game)return;
  const [a,b,c,p,d,sg,sb]=await Promise.all([
   supabase.from('presidential_election_settings').select('*').eq('game_id',game.id).maybeSingle(),
   supabase.from('presidential_candidates').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('presidential_scorecards').select('*').eq('game_id',game.id),
   supabase.from('presidential_candidate_program_points').select('*').eq('game_id',game.id).order('point_no'),
   supabase.from('presidential_candidate_documents').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('presidential_support_group').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('presidential_signature_batches').select('*').eq('game_id',game.id).order('direction_label')
  ]);
  if(!a.error&&a.data){const x=a.data as Settings;setSettings(x);setSystem(x.system_type);setThreshold(Number(x.threshold_pct));setPollEnabled(x.poll_enabled)}
  if(!b.error){const rows=(b.data||[]) as Candidate[];setCandidates(rows);setReview(Object.fromEntries(rows.map(x=>[x.id,{status:x.registration_status,errors:String(x.legal_error_count),penalty:String(x.rating_penalty)}])))}
  if(!c.error){const rows=(c.data||[]) as Score[];setScores(rows);const next:Record<string,Draft>={};for(const x of rows)next[x.candidate_id+'-'+x.round_no]={program:String(x.teacher_program_pct??''),campaign:String(x.teacher_campaign_pct??''),rating:String(x.game_rating_pct??''),poll:String(x.poll_pct??''),runoff:String(x.teacher_runoff_pct??'')};setDrafts(v=>({...v,...next}))}
  if(!p.error)setPoints((p.data||[]) as ProgramPoint[]);
  if(!d.error){
   const docs=(d.data||[]) as CandidateDoc[];
   const withUrls=await Promise.all(docs.map(async x=>({...x,url:(await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600)).data?.signedUrl||null})));
   setCandidateDocs(withUrls);
  }
  if(!sg.error)setSupporters((sg.data||[]) as Supporter[]);
  if(!sb.error)setSignatureBatches((sb.data||[]) as SignatureBatch[]);
  if(!b.error){
   const rr:Record<string,CandidateReadiness>={};
   await Promise.all(((b.data||[]) as Candidate[]).map(async x=>{const q=await supabase.rpc('get_presidential_candidate_readiness',{p_candidate_id:x.id});if(!q.error&&q.data)rr[x.id]=q.data as CandidateReadiness}));
   setReadiness(rr);
  }
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('presidential-lab:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_election_settings',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_candidates',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_scorecards',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_candidate_program_points',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_candidate_documents',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_support_group',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_signature_batches',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const activeGame=game;
 const activeMe=me;
 const score=(id:string,round:1|2)=>scores.find(x=>x.candidate_id===id&&x.round_no===round);
 const draft=(id:string,round:1|2)=>drafts[id+'-'+round]||emptyDraft();
 const setDraft=(id:string,round:1|2,key:keyof Draft,value:string)=>setDrafts(v=>({...v,[id+'-'+round]:{...emptyDraft(),...(v[id+'-'+round]||{}),[key]:value}}));
 const numberOrNull=(x:string)=>x.trim()===''?null:Number(x);
 const partyUsers=(partyId:string)=>{const p=parties.find(x=>x.id===partyId);return p?members.filter(m=>m.kind==='student'&&m.team===p.name):[]};

 async function configure(){setBusy(true);const r=await supabase.rpc('configure_presidential_election',{p_game_id:activeGame.id,p_system_type:system,p_threshold_pct:threshold,p_poll_enabled:pollEnabled});if(r.error)setError(r.error.message);else await load();setBusy(false)}
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
   setCandidateName('');setCandidateUser('');setProgram('');await load()
  }setBusy(false)
 }
 async function reviewCandidate(id:string){const x=review[id];if(!x)return;setBusy(true);const r=await supabase.rpc('review_presidential_candidate',{p_candidate_id:id,p_status:x.status,p_legal_errors:Number(x.errors)||0,p_rating_penalty:Number(x.penalty)||0});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function addProgramPoint(candidateId:string){
  const body=(pointDraft[candidateId]||'').trim();if(body.length<5)return;
  const next=Math.max(0,...points.filter(x=>x.candidate_id===candidateId).map(x=>x.point_no))+1;
  setBusy(true);const r=await supabase.rpc('save_presidential_program_point',{p_candidate_id:candidateId,p_point_no:next,p_body:body});
  if(r.error)setError(r.error.message);else{setPointDraft(v=>({...v,[candidateId]:''}));await load()}setBusy(false);
 }
 async function deleteProgramPoint(id:string){setBusy(true);const r=await supabase.rpc('delete_presidential_program_point',{p_point_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function uploadCandidateDoc(candidateId:string){
  const file=docFileDraft[candidateId],kind=docKindDraft[candidateId];if(!file||!kind)return;
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const storagePath=activeGame.id+'/presidential/'+candidateId+'/docs/'+crypto.randomUUID()+'.'+ext;
  setBusy(true);const up=await supabase.storage.from('game-assets').upload(storagePath,file,{contentType:file.type||'application/octet-stream'});
  if(up.error){setError(up.error.message);setBusy(false);return}
  const r=await supabase.rpc('add_presidential_candidate_document',{p_candidate_id:candidateId,p_doc_kind:kind,p_title:docLabels[kind]||file.name,p_storage_path:storagePath,p_file_name:file.name,p_mime_type:file.type||null,p_file_size:file.size});
  if(r.error)setError(r.error.message);else{setDocFileDraft(v=>({...v,[candidateId]:null}));await load()}setBusy(false);
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
 async function saveScore(id:string,round:1|2){const x=draft(id,round);setBusy(true);const r=await supabase.rpc('set_presidential_scorecard',{p_candidate_id:id,p_round_no:round,p_teacher_program_pct:round===1?numberOrNull(x.program):null,p_teacher_campaign_pct:round===1?numberOrNull(x.campaign):null,p_game_rating_pct:round===1?numberOrNull(x.rating):null,p_poll_pct:round===1&&pollEnabled?numberOrNull(x.poll):null,p_teacher_runoff_pct:round===2?numberOrNull(x.runoff):null});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function finish(round:1|2){setBusy(true);const r=await supabase.rpc('finalize_presidential_round',{p_game_id:activeGame.id,p_round_no:round});if(r.error)setError(r.error.message);else await load();setBusy(false)}

 return <section className="electionLab">
  <header className="electionLabHead"><div><small>ЭЛЕКТОРАЛЬНАЯ ЛАБОРАТОРИЯ · ЭТАПЫ 6–7</small><h2>Выборы Президента</h2><p>Все компоненты результата сохраняются отдельно: программа, агитация, игровой рейтинг, соцопрос и регистрационные штрафы.</p></div><div className="electionFormula"><b>1 тур</b><span>(программа + агитация + рейтинг{pollEnabled?' + опрос':''}) / {pollEnabled?'4':'3'} − штраф</span><b>2 тур</b><span>(результат 1 тура + новое голосование ППС) / 2</span></div></header>

  <div className="electionSettings"><div><small>СИСТЕМА</small><strong>{systemNames[settings?.system_type||system]}</strong><span>{settings?.system_type==='qualified'?'Порог '+settings.threshold_pct+'%':settings?.system_type==='preferential'?'Алгоритм подсчёта задаёт преподаватель':settings?.poll_enabled===false?'Без соцопроса':'Соцопрос включён'}</span></div>{teacher&&<div className="electionSettingsEdit"><select value={system} onChange={e=>setSystem(e.target.value as Settings['system_type'])}><option value="relative">Относительное большинство</option><option value="absolute">Абсолютное большинство</option><option value="qualified">Квалифицированное большинство</option><option value="preferential">Преференциальная</option></select>{system==='qualified'&&<input type="number" min="0" max="100" step="0.1" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/>}<label><input type="checkbox" checked={pollEnabled} onChange={e=>setPollEnabled(e.target.checked)}/> соцопрос</label><button disabled={busy} onClick={()=>void configure()}>Сохранить</button></div>}</div>

  {canNominate&&<details className="candidateNomination"><summary><div><b>Выдвинуть кандидата</b><span>Партия может иметь одного активного кандидата.</span></div><i>+</i></summary><div className="candidateNominationBody">{teacher&&<label>Партия<select value={candidateParty} onChange={e=>{setCandidateParty(e.target.value);setCandidateUser('')}}><option value="">Самовыдвижение / сценарный кандидат</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<label>Участник<select value={candidateUser} onChange={e=>setCandidateUser(e.target.value)}><option value="">{teacher?'Не привязывать к участнику':ledParty?'Выберите члена партии':'Я сам'}</option>{(teacher?(candidateParty?partyUsers(candidateParty):members.filter(m=>m.kind==='student')):ledParty?partyUsers(ledParty.id):[]).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>{teacher&&<label>Имя в бюллетене<input value={candidateName} onChange={e=>setCandidateName(e.target.value)} placeholder="Для вымышленного кандидата обязательно"/></label>}<label className="candidateProgram">Программа кандидата · один пункт с новой строки<textarea rows={7} value={program} onChange={e=>setProgram(e.target.value)} placeholder={"1. Положение программы\n2. Положение программы\n…\n10. Положение программы"}/></label><button className="primary" disabled={busy||(!teacher&&!!ledParty&&!candidateUser)} onClick={()=>void nominate()}>Подать на регистрацию</button></div></details>}

  <div className="candidateGrid">{candidates.length===0?<div className="emptyState">Кандидаты ещё не выдвинуты.</div>:candidates.map(c=>{
   const d1=draft(c.id,1),d2=draft(c.id,2),s1=score(c.id,1),s2=score(c.id,2),party=parties.find(p=>p.id===c.party_id);
   const runoffIds=(settings?.result?.candidate_ids||[]) as string[];
   const candidatePoints=points.filter(x=>x.candidate_id===c.id).sort((a,b)=>a.point_no-b.point_no);
   const docs=candidateDocs.filter(x=>x.candidate_id===c.id);
   const group=supporters.filter(x=>x.candidate_id===c.id);
   const sigs=signatureBatches.filter(x=>x.candidate_id===c.id);
   const ready=readiness[c.id];
   const canManage=teacher||c.user_id===activeMe.user_id||c.created_by===activeMe.user_id||(!!ledParty&&c.party_id===ledParty.id);
   const requiredKinds=c.nomination_type==='party'?partyDocs:c.nomination_type==='self'?selfDocs:[];
   const usedSupporterIds=new Set(supporters.filter(x=>x.candidate_id!==c.id).map(x=>x.supporter_user_id));
   return <article className={'candidateCard '+c.registration_status} key={c.id}><header><div className="candidateAvatar">{c.display_name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()}</div><div><small>{party?.name||(c.nomination_type==='self'?'Самовыдвижение':'Сценарный кандидат')}</small><h3>{c.display_name}</h3></div><span>{candidateStatus[c.registration_status]}</span></header>{c.program_summary&&<p className="candidateProgramText">{c.program_summary}</p>}<div className="candidateAudit"><span>Подач <b>{c.registration_attempts}</b></span><span>Юр. ошибок <b>{c.legal_error_count}</b></span><span>Штраф <b>−{Number(c.rating_penalty).toFixed(1)} п.п.</b></span></div>
   {c.nomination_type!=='fictional'&&<details className="candidateDossier" open={c.registration_status!=='registered'}>
    <summary><div><b>Досье кандидата</b><span>{ready?.ready?'✓ готово к регистрации':(ready?.issues?.[0]||'проверка комплекта')}</span></div><strong>{ready?.program_points||0}/10 · {ready?.accepted_documents||0}/{ready?.required_documents||requiredKinds.length}</strong></summary>
    <div className="candidateDossierBody">
     <section className="candidateProgramPoints"><header><div><small>ПРОГРАММА</small><h4>Минимум 10 положений</h4></div><span>{candidatePoints.length}/10</span></header><div>{candidatePoints.map(x=><p key={x.id}><b>{x.point_no}.</b><span>{x.body}</span>{canManage&&c.registration_status!=='registered'&&<IconAction variant="remove" onClick={()=>void deleteProgramPoint(x.id)} label={'Удалить положение программы № '+x.point_no}/>}</p>)}</div>{canManage&&c.registration_status!=='registered'&&<div className="candidatePointComposer"><input value={pointDraft[c.id]||''} onChange={e=>setPointDraft(v=>({...v,[c.id]:e.target.value}))} placeholder="Следующее положение программы"/><button disabled={busy||(pointDraft[c.id]||'').trim().length<5} onClick={()=>void addProgramPoint(c.id)}>＋ Добавить</button></div>}</section>
     <section className="candidateDocPack"><header><div><small>ПАКЕТ В ЦИК</small><h4>{c.nomination_type==='party'?'Партийное выдвижение':'Самовыдвижение'}</h4></div><span>{ready?.accepted_documents||0}/{ready?.required_documents||requiredKinds.length}</span></header><div className="candidateDocRows">{requiredKinds.map(kind=>{const doc=docs.find(x=>x.doc_kind===kind);return <div key={kind} className={doc?.status||'missing'}><span>{doc?.status==='accepted'?'✓':doc?.status==='revision'?'↺':doc?'○':'—'}</span><div><b>{docLabels[kind]}</b>{doc&&<a href={doc.url||'#'} target="_blank" rel="noreferrer">{doc.file_name}</a>}{doc?.note&&<small>{doc.note}</small>}</div>{teacher&&doc&&<div><button onClick={()=>void reviewCandidateDoc(doc.id,'accepted')}>Принять</button><button onClick={()=>void reviewCandidateDoc(doc.id,'revision')}>Доработка</button></div>}</div>})}</div>
     {canManage&&c.registration_status!=='registered'&&<div className="candidateDocUpload"><select value={docKindDraft[c.id]||requiredKinds.find(k=>!docs.some(d=>d.doc_kind===k))||requiredKinds[0]||''} onChange={e=>setDocKindDraft(v=>({...v,[c.id]:e.target.value}))}>{requiredKinds.map(k=><option key={k} value={k}>{docLabels[k]}</option>)}</select><label>Выбрать обезличенный учебный файл<input type="file" accept=".pdf,.doc,.docx,.txt,image/jpeg,image/png,image/webp" onChange={e=>setDocFileDraft(v=>({...v,[c.id]:e.target.files?.[0]||null}))}/></label><button disabled={busy||!docFileDraft[c.id]} onClick={()=>void uploadCandidateDoc(c.id)}>Загрузить</button></div>}
     </section>
     {c.nomination_type==='self'&&<section className="candidateSelfSupport"><header><div><small>САМОВЫДВИЖЕНИЕ</small><h4>Группа поддержки и подписи</h4></div><span>{group.length}/5 · {sigs.reduce((a,x)=>a+Number(x.signatures),0)}/15</span></header><div className="supportGroupList">{group.map(x=><div key={x.id}><b>{members.find(m=>m.user_id===x.supporter_user_id)?.full_name||'Участник'}</b>{canManage&&c.registration_status!=='registered'&&<IconAction variant="remove" onClick={()=>void removeSupporter(x.id)} label="Исключить участника из группы поддержки"/>}</div>)}</div>{canManage&&c.registration_status!=='registered'&&<div className="supportComposer"><select value={supporterDraft[c.id]||''} onChange={e=>setSupporterDraft(v=>({...v,[c.id]:e.target.value}))}><option value="">Добавить в группу поддержки…</option>{members.filter(m=>m.kind==='student'&&!usedSupporterIds.has(m.user_id)&&!group.some(x=>x.supporter_user_id===m.user_id)).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.group_name||'без направления'}</option>)}</select><button disabled={busy||!supporterDraft[c.id]} onClick={()=>void addSupporter(c.id)}>Добавить</button></div>}<div className="signatureBatchList">{sigs.map(x=><div key={x.id}><b>{x.direction_label}</b><span>{x.signatures}/5 подписей</span></div>)}</div>{canManage&&c.registration_status!=='registered'&&<div className="signatureComposer"><input value={directionDraft[c.id]||''} onChange={e=>setDirectionDraft(v=>({...v,[c.id]:e.target.value}))} placeholder="Направление ИГН"/><input type="number" min="0" max="5" value={signatureDraft[c.id]||''} onChange={e=>setSignatureDraft(v=>({...v,[c.id]:e.target.value}))} placeholder="0–5"/><button disabled={busy||(directionDraft[c.id]||'').trim().length<2} onClick={()=>void saveSignatureBatch(c.id)}>Записать подписи</button></div>}<p className="candidatePrivacyNote">В системе хранится только количество подписей по направлениям. Ф.И.О., даты рождения и реальные паспортные данные не нужны.</p></section>}
     {ready&&!ready.ready&&<div className="candidateReadinessIssues"><b>До регистрации осталось</b><ul>{ready.issues.map(x=><li key={x}>{x}</li>)}</ul></div>}
    </div>
   </details>}
   {teacher&&<div className="candidateReview"><select value={review[c.id]?.status||c.registration_status} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{errors:'0',penalty:'0'}),status:e.target.value as Candidate['registration_status']}}))}><option value="submitted">На проверке</option><option value="registered">Зарегистрировать</option><option value="revision">Доработка</option><option value="rejected">Отказать</option><option value="withdrawn">Снять</option></select><label>ошибки<input type="number" min="0" value={review[c.id]?.errors||'0'} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{status:c.registration_status,penalty:'0'}),errors:e.target.value}}))}/></label><label>штраф<input type="number" min="0" step="0.1" value={review[c.id]?.penalty||'0'} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{status:c.registration_status,errors:'0'}),penalty:e.target.value}}))}/></label><button disabled={busy} onClick={()=>void reviewCandidate(c.id)}>Зафиксировать</button></div>}
   {c.registration_status==='registered'&&<div className="candidateScores"><div className="candidateRound"><div className="candidateRoundTitle"><b>1 тур</b><strong>{s1?.computed_pct!=null?Number(s1.computed_pct).toFixed(2)+'%':'—'}</strong></div>{teacher&&<div className="scoreInputs"><label>Программа<input type="number" min="0" max="100" value={d1.program} onChange={e=>setDraft(c.id,1,'program',e.target.value)}/></label><label>Агитация<input type="number" min="0" max="100" value={d1.campaign} onChange={e=>setDraft(c.id,1,'campaign',e.target.value)}/></label><label>Рейтинг<input type="number" min="0" max="100" value={d1.rating} onChange={e=>setDraft(c.id,1,'rating',e.target.value)}/></label>{pollEnabled&&<label>Опрос<input type="number" min="0" max="100" value={d1.poll} onChange={e=>setDraft(c.id,1,'poll',e.target.value)}/></label>}<button disabled={busy} onClick={()=>void saveScore(c.id,1)}>Рассчитать</button></div>}</div>{settings?.status==='runoff'&&runoffIds.includes(c.id)&&<div className="candidateRound runoff"><div className="candidateRoundTitle"><b>2 тур</b><strong>{s2?.computed_pct!=null?Number(s2.computed_pct).toFixed(2)+'%':'—'}</strong></div>{teacher&&<div className="scoreInputs runoff"><label>Новое голосование ППС<input type="number" min="0" max="100" value={d2.runoff} onChange={e=>setDraft(c.id,2,'runoff',e.target.value)}/></label><button disabled={busy} onClick={()=>void saveScore(c.id,2)}>Рассчитать</button></div>}</div>}</div>}</article>
  })}</div>

  <footer className="electionResult"><div><small>ПРОТОКОЛ</small>{settings?.status==='finished'?<><h3>{String(settings.result?.winner||'Результат зафиксирован')}</h3><p>{settings.result?.score!=null?Number(settings.result.score).toFixed(2)+'%':''} · тур {settings.result?.round||'—'}</p></>:settings?.status==='runoff'?<><h3>Повторное голосование</h3><p>Второй тур для двух лидеров первого тура.</p></>:settings?.status==='manual_required'?<><h3>Ручной подсчёт</h3><p>Для преференциальной модели авторские правила не задают алгоритм перераспределения предпочтений.</p></>:<><h3>Ожидает расчёта</h3><p>Заполните компоненты рейтинга зарегистрированных кандидатов.</p></>}</div>{teacher&&<div>{settings?.status==='runoff'?<button className="primary" disabled={busy} onClick={()=>void finish(2)}>Завершить 2 тур</button>:settings?.status!=='finished'&&<button className="primary" disabled={busy} onClick={()=>void finish(1)}>Завершить 1 тур</button>}</div>}</footer>
 </section>;
}
