'use client';
import {userError} from '@/lib/userError';
import PresidentialRulesCalculator from './PresidentialRulesCalculator';
import PresidentialCecPublicationPanel from './PresidentialCecPublicationPanel';
import PresidentialCecComplaints from './PresidentialCecComplaints';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useGameTableSync} from './useGameTableSync';
import {BarChart3,Check,Copy,ExternalLink,FileUp,Landmark,Send,Share2,Vote,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import InstitutionEmblemImage from './InstitutionEmblemImage';
import {institutionEmblem} from './institutionEmblems';
import MediaUploadButton from './MediaUploadButton';

type Candidate={id:string;user_id:string|null;party_id:string|null;created_by:string;display_name:string;registration_status:string;photo_path:string|null;program_summary:string|null;campaign_statement:string|null;rating_penalty:number};
type Material={id:string;candidate_id:string;author_id:string;title:string;body:string;material_type:string;print_run:number;publisher_name:string|null;production_date:string|null;imprint_text:string|null;external_url:string|null;files:Array<{storage_path:string;file_name:string;mime_type?:string|null;file_size?:number;media_kind?:string}>;status:'pending'|'approved'|'rejected';review_note:string|null;cec_errors:string|null;cec_response:string|null;penalty_points:number;penalty_reason:string|null;post_id:string|null;created_at:string};
type PollDecision={game_id:string;status:'open'|'closed';result:boolean|null;opened_at:string;closed_at:string|null};
type PublicPoll={id:string;game_id:string;round_no:number;slug:string;title:string;status:'draft'|'open'|'closed';opened_at:string|null;closes_at:string|null;closed_at:string|null};
type Settings={game_id:string;system_type:'relative'|'absolute'|'qualified'|'preferential';threshold_pct:number;poll_enabled:boolean;status:'setup'|'round1'|'runoff'|'finished'|'manual_required';result:Record<string,any>};
type Score={candidate_id:string;round_no:1|2;teacher_program_pct:number|null;teacher_campaign_pct:number|null;game_rating_pct:number|null;poll_pct:number|null;teacher_runoff_pct:number|null;computed_pct:number|null};
type Inauguration={game_id:string;scheduled_at:string|null;venue:string|null;notes:string|null;hymn_path:string|null;ceremonial_music_path:string|null;updated_at:string};

const MATERIAL_LABELS:Record<string,string>={poster:'Плакат',leaflet:'Листовка',video:'Видео',audio:'Аудио',news:'Новость',other:'Другое'};
const SYSTEM_NAMES={relative:'Относительное большинство',absolute:'Абсолютное большинство',qualified:'Квалифицированное большинство',preferential:'Преференциальная система'} as const;

export default function PresidentialElectionStage7({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,parties,setError}=g;
 const gameId=game?.id||'';
 const [tab,setTab]=useState<'campaign'|'poll'|'complaints'|'results'>('campaign');
 const [candidates,setCandidates]=useState<Candidate[]>([]);
 const [materials,setMaterials]=useState<Material[]>([]);
 const [decision,setDecision]=useState<PollDecision|null>(null);
 const [publicPolls,setPublicPolls]=useState<PublicPoll[]>([]);
 const [settings,setSettings]=useState<Settings|null>(null);
 const [stage6Ready,setStage6Ready]=useState(false);
 const [scores,setScores]=useState<Score[]>([]);

 const [inauguration,setInauguration]=useState<Inauguration|null>(null);
 const [inaugurationConfirmed,setInaugurationConfirmed]=useState(false);
 const [photoUrls,setPhotoUrls]=useState<Record<string,string>>({});
 const [audioUrls,setAudioUrls]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [candidateId,setCandidateId]=useState('');
 const [materialType,setMaterialType]=useState('poster');
 const [title,setTitle]=useState('');
 const [body,setBody]=useState('');
 const [printRun,setPrintRun]=useState('');
 const [publisher,setPublisher]=useState('');
 const [productionDate,setProductionDate]=useState('');
 const [imprint,setImprint]=useState('');
 const [externalUrl,setExternalUrl]=useState('');
 const [files,setFiles]=useState<File[]>([]);
 const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
 const [reviewErrors,setReviewErrors]=useState<Record<string,string>>({});
 const [reviewResponses,setReviewResponses]=useState<Record<string,string>>({});
 const [reviewPenalties,setReviewPenalties]=useState<Record<string,string>>({});
 const [reviewPenaltyReasons,setReviewPenaltyReasons]=useState<Record<string,string>>({});
 const [pollClose,setPollClose]=useState('');

 const [ceremonyAt,setCeremonyAt]=useState('');
 const [venue,setVenue]=useState('');
 const [ceremonyNotes,setCeremonyNotes]=useState('');
 const [hymnLink,setHymnLink]=useState('');
 const [musicLink,setMusicLink]=useState('');

 const viewScope=JSON.stringify([gameId,me?.user_id,me?.kind,teacher]);
 const scope=useRef(viewScope),request=useRef(0),alive=useRef(true),ceremonyDirty=useRef(false);
 scope.current=viewScope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++}},[]);
 useEffect(()=>{
  request.current++;ceremonyDirty.current=false;
  setCandidates([]);setMaterials([]);setDecision(null);setPublicPolls([]);setSettings(null);setStage6Ready(false);setScores([]);setInauguration(null);setInaugurationConfirmed(false);setPhotoUrls({});setAudioUrls({});
  setCandidateId('');setCeremonyAt('');setVenue('');setCeremonyNotes('');setHymnLink('');setMusicLink('');setBusy(false);setNotice('');
  setTitle('');setBody('');setPrintRun('');setPublisher('');setProductionDate('');setImprint('');setExternalUrl('');setFiles([]);
  setMaterialType('poster');setPollClose('');setReviewNotes({});setReviewErrors({});setReviewResponses({});setReviewPenalties({});setReviewPenaltyReasons({});
 },[viewScope]);
 const activeScope=()=>alive.current&&scope.current===viewScope;

 const registered=candidates.filter(c=>c.registration_status==='registered');
 // Полномочия на агитацию имеют все действующие члены выдвинувшей партии,
 // а не только кандидат или председатель партии. Совпадает с серверным правилом ЦИК.
 const canManage=(c:Candidate)=>teacher||c.user_id===me?.user_id||c.created_by===me?.user_id||
  (me?.kind==='student'&&!me.roster_archived_at&&!!c.party_id&&parties.some(p=>
    p.id===c.party_id&&p.game_id===gameId&&p.registration_status==='registered'&&p.name===me.team));
 const mine=registered.filter(canManage);
 const selectedCandidate=mine.find(c=>c.id===candidateId)||mine[0]||null;
 const isStudent=members.some(m=>m.user_id===me?.user_id&&m.kind==='student');
 const activeRound=settings?.status==='runoff'?2:1;
 const publicPoll=publicPolls.find(p=>p.round_no===1)||null;
 const pollApproved=decision?.status==='closed'&&decision.result===true;
 const activeTab=tab==='poll'&&!pollApproved?'campaign':tab;
 const resultRows=useMemo(()=>registered.map(c=>({
  candidate:c,
  score:scores.find(s=>s.candidate_id===c.id&&s.round_no===(settings?.status==='runoff'||settings?.result?.round===2?2:1))?.computed_pct??scores.find(s=>s.candidate_id===c.id&&s.round_no===1)?.computed_pct??null,
  poll:scores.find(s=>s.candidate_id===c.id&&s.round_no===1)?.poll_pct??null
 })).sort((a,b)=>Number(b.score??-1)-Number(a.score??-1)),[registered,scores,settings?.status,settings?.result?.round]);

 function validCeremonyAudioLink(value:string){
  if(!value.trim())return true;
  if(value.length>2048||/\s/.test(value))return false;
  try{const url=new URL(value.trim());return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password;}catch{return false}
 }
 function isExternalAudioLink(value:string|null|undefined){return !!value&&/^https?:\/\//i.test(value)}
 function isDirectAudioLink(value:string){try{return /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|webm)$/i.test(new URL(value).pathname)}catch{return false}}
 async function signed(path:string|null){
  if(!path)return '';
  if(isExternalAudioLink(path))return validCeremonyAudioLink(path)?path:'';
  const r=await supabase.storage.from('game-assets').createSignedUrl(path,3600);
  return r.data?.signedUrl||'';
 }
 async function load(){
  if(!gameId)return;
  const version=++request.current,current=()=>activeScope()&&version===request.current;
  try{
  const [cr,mr,dr,pr,sr,sc,ir,stageDecision,ceremonyPost]=await Promise.all([
   supabase.from('presidential_candidates').select('id,user_id,party_id,created_by,display_name,registration_status,photo_path,program_summary,campaign_statement,rating_penalty').eq('game_id',gameId).is('archived_at',null).order('display_name'),
   supabase.from('presidential_campaign_materials').select('*').eq('game_id',gameId).order('created_at',{ascending:false}),
   supabase.from('presidential_poll_decision').select('*').eq('game_id',gameId).maybeSingle(),
   supabase.from('presidential_public_polls').select('*').eq('game_id',gameId).order('round_no'),
   supabase.from('presidential_election_settings').select('*').eq('game_id',gameId).maybeSingle(),
   supabase.from('presidential_scorecards').select('*').eq('game_id',gameId),
   supabase.from('presidential_inauguration').select('*').eq('game_id',gameId).maybeSingle(),
   supabase.rpc('get_presidential_student_system_vote',{p_game_id:gameId}),
   supabase.from('political_posts').select('id').eq('game_id',gameId).eq('source_key','cec-presidential-inauguration:'+gameId).maybeSingle()
  ]);
  if(!current())return;
  const failure=[cr,mr,dr,pr,sr,sc,ir,stageDecision,ceremonyPost].find(result=>result.error);if(failure?.error)throw failure.error;
  setStage6Ready(Boolean(stageDecision.data?.closed));setInaugurationConfirmed(Boolean(ceremonyPost.data?.id));
  const rows=(cr.data||[]) as Candidate[],scoreRows=(sc.data||[]) as Score[],ceremony=ir.data as Inauguration|null;
  const [pairs,hymn,music]=await Promise.all([
   Promise.all(rows.filter(x=>x.photo_path).map(async x=>[x.id,await signed(x.photo_path)] as const)),
   signed(ceremony?.hymn_path||null),signed(ceremony?.ceremonial_music_path||null)
  ]);
  if(!current())return;
  setCandidates(rows);setPhotoUrls(Object.fromEntries(pairs.filter(x=>x[1])));
  const preferred=rows.find(x=>x.registration_status==='registered'&&canManage(x));
  setCandidateId(previous=>rows.some(x=>x.id===previous&&x.registration_status==='registered'&&canManage(x))?previous:preferred?.id||'');
  setMaterials((mr.data||[]) as Material[]);setDecision(dr.data as PollDecision|null);setPublicPolls((pr.data||[]) as PublicPoll[]);setSettings(sr.data as Settings|null);
  setScores(scoreRows);

  setInauguration(ceremony);setAudioUrls({hymn,music});
  if(!ceremonyDirty.current){setCeremonyAt(ceremony?.scheduled_at?new Date(ceremony.scheduled_at).toISOString().slice(0,16):'');setVenue(ceremony?.venue||'');setCeremonyNotes(ceremony?.notes||'');setHymnLink(isExternalAudioLink(ceremony?.hymn_path)?ceremony!.hymn_path!:'');setMusicLink(isExternalAudioLink(ceremony?.ceremonial_music_path)?ceremony!.ceremonial_music_path!:'')}
  }catch(error){if(current())setError(error)}
 }
 useGameTableSync(gameId,['presidential_candidates','presidential_campaign_materials','presidential_poll_decision','presidential_public_polls','presidential_scorecards','presidential_election_settings','presidential_inauguration','game_parties','political_posts'],load,viewScope);

 if(!game||!me)return null;
 const baseUrl=typeof window!=='undefined'?window.location.origin:'';
 const assetBase=(process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'').replace(/\/$/,'');
 const pollUrl=publicPoll?baseUrl+assetBase+'/poll?slug='+encodeURIComponent(publicPoll.slug):'';
 const pollCanOpen=activeRound===1&&['setup','round1'].includes(settings?.status||'')&&pollApproved&&settings?.poll_enabled!==false;

 async function submitMaterial(){
  if(!selectedCandidate||busy||title.trim().length<3||body.trim().length<3)return;
  const uploaded:string[]=[];setBusy(true);setNotice('');
  try{
   const attachments=[];
   for(const file of files){
    if(file.size>104857600)throw new Error('Размер одного вложения не должен превышать 100 МБ');
    const path=gameId+'/presidential/'+selectedCandidate.id+'/campaign/'+crypto.randomUUID()+'.'+(file.name.split('.').pop()||'bin');
    const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||'application/octet-stream'});
    if(up.error)throw up.error;uploaded.push(path);
    attachments.push({storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size,media_kind:file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':file.type.startsWith('video/')?'video':'file'});
   }
   const r=await supabase.rpc('submit_presidential_campaign_material',{p_candidate_id:selectedCandidate.id,p_title:title.trim(),p_body:body.trim(),p_material_type:materialType,p_print_run:Math.max(0,Number(printRun)||0),p_publisher_name:publisher.trim()||null,p_production_date:productionDate||null,p_imprint_text:imprint.trim()||null,p_external_url:externalUrl.trim()||null,p_files:attachments});
   if(r.error)throw r.error;
   setTitle('');setBody('');setPrintRun('');setPublisher('');setProductionDate('');setImprint('');setExternalUrl('');setFiles([]);
   setNotice('Материал направлен в ЦИК. После одобрения ЦИК он автоматически появится в «Политическом процессе».');
   await load();
  }catch(e){
   if(uploaded.length)await supabase.storage.from('game-assets').remove(uploaded);
   setError(userError(e)||'Не удалось выполнить действие.');
  }finally{setBusy(false)}
 }
 async function reviewMaterial(id:string,approve:boolean){
  const penaltyRaw=(reviewPenalties[id]||'').trim();
  const penalty=penaltyRaw===''?0:Math.max(0,Math.min(100,Number(penaltyRaw)||0));
  setBusy(true);
  const r=await supabase.rpc('review_presidential_campaign_material_cec',{
   p_material_id:id,
   p_approve:approve,
   p_note:(reviewNotes[id]||'').trim()||null,
   p_errors:(reviewErrors[id]||'').trim()||null,
   p_response:(reviewResponses[id]||'').trim()||null,
   p_penalty_points:penalty,
   p_penalty_reason:(reviewPenaltyReasons[id]||'').trim()||null
  });
  if(r.error)setError(userError(r.error));
  else{
   setNotice(approve?'ЦИК одобрил материал и опубликовал его в политическом процессе.':'ЦИК отклонил материал.');
   await load();
  }
  setBusy(false);
 }



 async function createPublicPoll(){
  setBusy(true);const r=await supabase.rpc('create_presidential_public_poll',{p_game_id:gameId,p_round_no:activeRound,p_closes_at:pollClose?new Date(pollClose).toISOString():null});
  if(r.error)setError(userError(r.error));else{setNotice('Публичный опрос открыт. Ссылку можно распространять во внешних сетях.');await load()}setBusy(false);
 }
 async function closePublicPoll(){if(!publicPoll)return;setBusy(true);const r=await supabase.rpc('close_presidential_public_poll',{p_game_id:gameId,p_round_no:publicPoll.round_no});if(r.error)setError(userError(r.error));else{setNotice('Опрос закрыт; его проценты перенесены в калькулятор выборов.');await load()}setBusy(false)}
 async function copyPoll(){if(!pollUrl)return;await navigator.clipboard.writeText(pollUrl);setNotice('Ссылка на опрос скопирована.')}
 function share(service:'vk'|'tg'){if(!pollUrl)return;const u=encodeURIComponent(pollUrl),t=encodeURIComponent('Социологический опрос: выборы Президента РФ');window.open(service==='vk'?'https://vk.com/share.php?url='+u+'&title='+t:'https://t.me/share/url?url='+u+'&text='+t,'_blank','noopener,noreferrer')}

 async function confirmCeremony(){
  if(!teacher||!gameId||busy)return;
  setBusy(true);
  try{
   const r=await supabase.rpc('confirm_presidential_inauguration',{p_game_id:gameId});
   if(r.error)throw r.error;
   setNotice('Инаугурация подтверждена. Победитель вступил в должность и получил полномочия Президента.');
   await load();await g.refresh();
  }catch(error){setError(userError(error))}finally{setBusy(false)}
 }
 async function saveCeremony(){
  if(!validCeremonyAudioLink(hymnLink)||!validCeremonyAudioLink(musicLink)){setError('Укажите корректные HTTPS-ссылки на аудио без пробелов и данных для входа.');return}
  setBusy(true);try{
   const hymn=hymnLink.trim()||(inauguration?.hymn_path&&!isExternalAudioLink(inauguration.hymn_path)?inauguration.hymn_path:null);
   const music=musicLink.trim()||(inauguration?.ceremonial_music_path&&!isExternalAudioLink(inauguration.ceremonial_music_path)?inauguration.ceremonial_music_path:null);
   const r=await supabase.rpc('save_presidential_inauguration',{p_game_id:gameId,p_scheduled_at:ceremonyAt?new Date(ceremonyAt).toISOString():null,p_venue:venue.trim()||null,p_notes:ceremonyNotes.trim()||null,p_hymn_path:hymn,p_ceremonial_music_path:music});
   if(!activeScope())return;
   if(r.error)throw r.error;ceremonyDirty.current=false;setNotice('Параметры инаугурации и ссылки на аудио сохранены.');await load();
  }catch(e){if(activeScope())setError(userError(e)||'Не удалось выполнить действие.')}finally{if(activeScope())setBusy(false)}
 }

 if(!stage6Ready)return <section className="stage7Election"><div className="stage7Empty">Выборы Президента Российской Федерации ещё не начались. Сначала Совет Федерации назначает три дня выборов, а студенты на этапе 6 лично утверждают избирательную систему и необходимость социологического опроса.</div></section>;
 return <section className="stage7Election">
  <header className="stage7Hero"><div><small>ЦИК РФ · ЭТАП 7</small><h2>Выборы Президента Российской Федерации</h2><p>Агитационная кампания, {pollApproved?'социологический опрос, ':''}подсчёт результатов ЦИК и инаугурация — в одном контуре.</p></div><div className="stage7HeroMark"><InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="ЦИК РФ" width={74} height={74}/><span>Центральная избирательная комиссия</span></div></header>
  <nav className={'stage7Tabs '+(pollApproved?'':'withoutPoll')} aria-label="Разделы этапа 7"><button className={activeTab==='campaign'?'active':''} onClick={()=>setTab('campaign')}><span>01</span>Кампания</button>{pollApproved&&<button className={activeTab==='poll'?'active':''} onClick={()=>setTab('poll')}><span>02</span>Соцопрос избирателей</button>}<button className={activeTab==='complaints'?'active':''} onClick={()=>setTab('complaints')}><span>{pollApproved?'03':'02'}</span>Жалобы в ЦИК</button><button className={activeTab==='results'?'active':''} onClick={()=>setTab('results')}><span>{pollApproved?'04':'03'}</span>Итоги и инаугурация</button></nav>
  {notice&&<div className="stage7Notice">{notice}</div>}

  {activeTab==='campaign'&&<div className="stage7Grid">
   <section className="stage7Panel campaignComposer"><div className="stage7PanelHead"><div><small>ПОДАЧА В ЦИК</small><h3>Агитационный материал</h3><p>Форма повторяет публикацию в «Политическом процессе», но без НПА и голосований. До публикации материал проходит проверку и модерацию ЦИК.</p></div><FileUp size={24}/></div>
    {mine.length?<div className="campaignForm">
     <label>Кандидат<select value={selectedCandidate?.id||''} onChange={e=>setCandidateId(e.target.value)}>{mine.map(c=><option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label><label>Тип материала<select value={materialType} onChange={e=>setMaterialType(e.target.value)}>{Object.entries(MATERIAL_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
     <label className="wide">Заголовок<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название агитационного материала"/></label><label className="wide">Текст<textarea rows={6} value={body} onChange={e=>setBody(e.target.value)} placeholder="Новость, обращение кандидата, текст листовки или описание видео"/></label>
     {(materialType==='poster'||materialType==='leaflet')&&<><label>Тираж<input type="number" min="1" value={printRun} onChange={e=>setPrintRun(e.target.value)} placeholder="1000"/></label><label>Дата изготовления<input type="date" value={productionDate} onChange={e=>setProductionDate(e.target.value)}/></label><label className="wide">Выходные данные<input value={imprint} onChange={e=>setImprint(e.target.value)} placeholder="Заказчик, изготовитель, источник финансирования и иные выходные сведения"/></label></>}
     <label>Изготовитель / распространитель<input value={publisher} onChange={e=>setPublisher(e.target.value)} placeholder="Наименование"/></label><label>Внешняя ссылка<input type="url" value={externalUrl} onChange={e=>setExternalUrl(e.target.value)} placeholder="https://…"/></label><div className="wide"><MediaUploadButton files={files} onChange={setFiles} label="Фото, видео, аудио или файл" hint="До 12 вложений"/></div>
     <div className="campaignSubmit wide"><span>После одобрения ЦИК публикация автоматически появится в политическом процессе от имени кандидата.</span><button className="primary" disabled={busy||!selectedCandidate||title.trim().length<3||body.trim().length<3||((materialType==='poster'||materialType==='leaflet')&&(!Number(printRun)||imprint.trim().length<3))} onClick={()=>void submitMaterial()}><Send size={17}/>{busy?'Отправляется…':'Направить в ЦИК'}</button></div>
    </div>:<div className="stage7Empty">Нет зарегистрированного кандидата, которым вы можете управлять.</div>}
   </section>
   <section className="stage7Panel"><div className="stage7PanelHead"><div><small>РЕЕСТР</small><h3>Материалы кампании</h3><p>{teacher?'Панель ЦИК: зафиксируйте ошибки и официальный ответ, при необходимости назначьте штраф. Одобрение публикует материал автоматически.':'Следите за статусом отправленных материалов.'}</p></div><Landmark size={24}/></div>
     <div className="campaignQueue">{materials.filter(m=>teacher||mine.some(c=>c.id===m.candidate_id)).map(m=>{const c=registered.find(x=>x.id===m.candidate_id);return <article key={m.id} className={'campaignCard '+m.status}>
      <div className="campaignCardTop"><div className="candidateMini">{photoUrls[m.candidate_id]?<img src={photoUrls[m.candidate_id]} alt=""/>:<span>{(c?.display_name||'?').slice(0,1)}</span>}<div><small>{MATERIAL_LABELS[m.material_type]||'Агитационный материал'}</small><b>{c?.display_name||'Кандидат'}</b></div></div><em>{m.status==='pending'?'На проверке ЦИК':m.status==='approved'?'Одобрено ЦИК':'Отклонено ЦИК'}</em></div>
      <h4>{m.title}</h4><p>{m.body}</p>
      {(m.print_run>0||m.imprint_text)&&<div className="campaignImprint">{m.print_run>0&&<span>Тираж: <b>{m.print_run.toLocaleString('ru-RU')}</b></span>}{m.imprint_text&&<span>{m.imprint_text}</span>}</div>}
      {(m.cec_errors||m.cec_response||m.review_note||Number(m.penalty_points)>0)&&<div className="cecDecisionSummary">
       {m.cec_errors&&<div><small>ОШИБКИ / НАРУШЕНИЯ</small><p>{m.cec_errors}</p></div>}
       {m.cec_response&&<div><small>ОТВЕТ ЦИК</small><p>{m.cec_response}</p></div>}
       {m.review_note&&<div><small>КОММЕНТАРИЙ</small><p>{m.review_note}</p></div>}
       {Number(m.penalty_points)>0&&<div className="cecPenaltySummary"><small>ШТРАФ</small><b>−{Number(m.penalty_points).toFixed(2)} п.</b>{m.penalty_reason&&<p>{m.penalty_reason}</p>}</div>}
      </div>}
      {teacher&&m.status==='pending'&&<div className="campaignModeration cecModerationPanel">
       <div className="cecModerationTitle"><div><small>ПАНЕЛЬ ЦИК</small><b>Решение по агитационному материалу</b></div>{c&&<span>Суммарный штраф кандидата: <strong>−{Number(c.rating_penalty||0).toFixed(2)} п.</strong></span>}</div>
       <label><span>Ошибки / нарушения</span><textarea rows={3} value={reviewErrors[m.id]||''} onChange={e=>setReviewErrors(v=>({...v,[m.id]:e.target.value}))} placeholder="Что нарушено, какие реквизиты отсутствуют, какие ошибки обнаружены"/></label>
       <label><span>Официальный ответ ЦИК</span><textarea rows={3} value={reviewResponses[m.id]||''} onChange={e=>setReviewResponses(v=>({...v,[m.id]:e.target.value}))} placeholder="Что необходимо исправить / разъяснение решения ЦИК"/></label>
       <div className="cecPenaltyGrid">
        <label><span>Штраф, баллов</span><input type="number" min="0" max="100" step="0.5" value={reviewPenalties[m.id]||''} onChange={e=>setReviewPenalties(v=>({...v,[m.id]:e.target.value}))} placeholder="0"/></label>
        <label><span>Основание штрафа</span><input value={reviewPenaltyReasons[m.id]||''} onChange={e=>setReviewPenaltyReasons(v=>({...v,[m.id]:e.target.value}))} placeholder="Причина и основание"/></label>
       </div>
       <label><span>Служебный комментарий ЦИК</span><textarea rows={2} value={reviewNotes[m.id]||''} onChange={e=>setReviewNotes(v=>({...v,[m.id]:e.target.value}))} placeholder="Дополнительный комментарий"/></label>
       <div className="cecDecisionActions"><button className="secondary dangerAction" disabled={busy} onClick={()=>void reviewMaterial(m.id,false)}><X size={16}/>Отклонить</button><button className="primary" disabled={busy} onClick={()=>void reviewMaterial(m.id,true)}><Check size={16}/>Одобрить и опубликовать</button></div>
      </div>}
     </article>})}{!materials.length&&<div className="stage7Empty">Агитационные материалы ещё не поданы.</div>}</div>
   </section>
  </div>}

  {activeTab==='complaints'&&<PresidentialCecComplaints g={g} candidates={candidates}/>}

  {pollApproved&&activeTab==='poll'&&activeRound===2&&<div className="stage7Empty">Во втором туре проводится новое голосование преподавателей. Внесите его во вкладке итогов ЦИК; публичный соцопрос в формулу второго тура не входит.</div>}
  {pollApproved&&activeTab==='poll'&&activeRound===1&&<div className="stage7Grid pollGrid">
   <section className="stage7Panel"><div className="stage7PanelHead"><div><small>РЕШЕНИЕ ШЕСТОГО ЭТАПА</small><h3>Социологический опрос</h3><p>Нужен ли опрос, решили студенты личным голосованием на этапе 6. ЦИК не меняет их решение.</p></div><Vote size={24}/></div><div className="stage7Notice"><b>{decision?.status==='closed'?(decision.result?'Социологический опрос включён':'Социологический опрос исключён'):'Решение ещё не завершено на этапе 6'}</b></div></section>
   <section className="stage7Panel"><div className="stage7PanelHead"><div><small>ПУБЛИЧНЫЙ ОПРОС</small><h3>Опрос избирателей</h3><p>Открытая форма доступна по внешней ссылке без входа в игру.</p></div><Share2 size={24}/></div>
    {!pollCanOpen&&<div className="stage7Empty">{decision?.status==='open'?'Сначала завершите голосование студентов.':decision?.result===false?'Студенты решили не использовать соцопрос в формуле выборов.':'Решение о соцопросе ещё не принято.'}</div>}
    {pollCanOpen&&!publicPoll&&teacher&&<div className="pollCreate"><label>Закрыть опрос<input type="datetime-local" value={pollClose} onChange={e=>setPollClose(e.target.value)}/></label><button className="primary" disabled={busy} onClick={()=>void createPublicPoll()}>Создать публичный опрос</button></div>}
    {publicPoll&&<div className="publicPollControl"><div className="pollLink"><input readOnly value={pollUrl}/><button className="secondary" onClick={()=>void copyPoll()}><Copy size={16}/>Копировать</button></div><div className="pollShareButtons"><button onClick={()=>share('vk')}>ВКонтакте</button><button onClick={()=>share('tg')}>Телеграм</button><a href={pollUrl} target="_blank" rel="noreferrer">Открыть <ExternalLink size={14}/></a></div><p>Статус: <b>{publicPoll.status==='open'?'открыт':'закрыт'}</b>{publicPoll.closes_at?' · до '+new Date(publicPoll.closes_at).toLocaleString('ru-RU'):''}</p>{teacher&&pollCanOpen&&publicPoll.status==='open'&&<button className="secondary stage7MainAction" disabled={busy} onClick={()=>void closePublicPoll()}>Закрыть опрос и перенести проценты в калькулятор</button>}</div>}
   </section>
  </div>}

  {activeTab==='results'&&<div className="stage7Results">
    <PresidentialRulesCalculator g={g} candidates={registered} settings={settings} pollApproved={pollApproved} onSaved={load}/>
    <PresidentialCecPublicationPanel g={g} status={settings?.status} onSaved={load}/>
   <section className="stage7Panel officialResults"><div className="stage7PanelHead"><div><small>ОФИЦИАЛЬНЫЕ ИТОГИ</small><h3>{settings?.status==='finished'?'Выборы завершены':settings?.status==='runoff'?'Назначен второй тур':'Ожидается расчёт ЦИК'}</h3></div><InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="ЦИК РФ" width={52} height={52}/></div>
    {settings?.status==='finished'&&<div className="winnerCard">{(()=>{const winner=registered.find(c=>c.id===settings.result?.winner_id)||resultRows[0]?.candidate;return winner?<><div className="winnerPhoto">{photoUrls[winner.id]?<img src={photoUrls[winner.id]} alt={winner.display_name}/>:<span>{winner.display_name.slice(0,1)}</span>}</div><div><small>ПОБЕДИТЕЛЬ ПО РАСЧЁТУ ЦИК</small><h2>{winner.display_name}</h2><p>{settings.result?.score!=null?Number(settings.result.score).toFixed(2)+'% · ':''}{SYSTEM_NAMES[settings.system_type]}</p></div></>:null})()}</div>}
    <div className="resultBars">{resultRows.map((row,index)=><div key={row.candidate.id} className="resultBarRow"><div><span>{index+1}</span><b>{row.candidate.display_name}</b><strong>{row.score!=null?Number(row.score).toFixed(2)+'%':'—'}</strong></div><div className="resultBar"><i style={{width:Math.max(0,Math.min(100,Number(row.score)||0))+'%'}}/></div>{pollApproved&&row.poll!=null&&<small>Соцопрос: {Number(row.poll).toFixed(2)}%</small>}</div>)}</div>
   </section>
   <section className="stage7Panel inaugurationPanel"><div className="stage7PanelHead"><div><small>ИНАУГУРАЦИЯ</small><h3>Вступление избранного Президента в должность</h3><p>После фиксации итогов преподаватель задаёт дату, место и аудиосопровождение церемонии.</p></div><Landmark size={24}/></div>
    {teacher?<div className="inaugurationForm"><label>Дата и время<input type="datetime-local" disabled={busy} value={ceremonyAt} onChange={e=>{ceremonyDirty.current=true;setCeremonyAt(e.target.value)}}/></label><label>Место<input disabled={busy} value={venue} onChange={e=>{ceremonyDirty.current=true;setVenue(e.target.value)}} placeholder="Место проведения"/></label><label className="wide">Сценарий / примечания<textarea rows={4} disabled={busy} value={ceremonyNotes} onChange={e=>{ceremonyDirty.current=true;setCeremonyNotes(e.target.value)}} placeholder="Краткий порядок церемонии"/></label><label className="ceremonyAudioLinkField">Гимн России · Ссылка<input type="url" inputMode="url" disabled={busy} value={hymnLink} aria-invalid={!validCeremonyAudioLink(hymnLink)} onChange={e=>{ceremonyDirty.current=true;setHymnLink(e.target.value)}} placeholder="https://example.ru/gimn.mp3"/><small>Прямая HTTPS-ссылка на аудио. Файл загружать не нужно.</small>{inauguration?.hymn_path&&!isExternalAudioLink(inauguration.hymn_path)&&<small>Ранее загруженный гимн сохранится, пока вы не укажете новую ссылку.</small>}</label><label className="ceremonyAudioLinkField">Церемониальная музыка · Ссылка<input type="url" inputMode="url" disabled={busy} value={musicLink} aria-invalid={!validCeremonyAudioLink(musicLink)} onChange={e=>{ceremonyDirty.current=true;setMusicLink(e.target.value)}} placeholder="https://example.ru/muzyka.mp3"/><small>Можно добавить HTTPS-ссылку на аудио или страницу музыкального сервиса.</small>{inauguration?.ceremonial_music_path&&!isExternalAudioLink(inauguration.ceremonial_music_path)&&<small>Ранее загруженная музыка сохранится, пока вы не укажете новую ссылку.</small>}</label><button className="primary wide" disabled={busy||!validCeremonyAudioLink(hymnLink)||!validCeremonyAudioLink(musicLink)} onClick={()=>void saveCeremony()}>Сохранить инаугурацию</button>{inaugurationConfirmed?<p className="wide stage7Notice">Инаугурация подтверждена. Полномочия Президента Российской Федерации действуют.</p>:<button className="secondary wide" disabled={busy||settings?.status!=='finished'||!inauguration?.scheduled_at||new Date(inauguration.scheduled_at).getTime()>Date.now()} onClick={()=>void confirmCeremony()}>Подтвердить инаугурацию и передать полномочия Президента</button>}</div>:inauguration?<div className="ceremonyPublic"><b>{inauguration.scheduled_at?new Date(inauguration.scheduled_at).toLocaleString('ru-RU'):'Дата уточняется'}</b><span>{inauguration.venue||'Место уточняется'}</span>{inauguration.notes&&<p>{inauguration.notes}</p>}</div>:<div className="stage7Empty">Параметры инаугурации ещё не опубликованы.</div>}
    {(audioUrls.hymn||audioUrls.music)&&<div className="ceremonyAudio">{audioUrls.hymn&&<div className="ceremonyAudioCard"><b>Гимн России</b>{(!isExternalAudioLink(inauguration?.hymn_path)||isDirectAudioLink(audioUrls.hymn))&&<audio controls preload="none" src={audioUrls.hymn}/>} {isExternalAudioLink(inauguration?.hymn_path)&&<a href={audioUrls.hymn} target="_blank" rel="noopener noreferrer">Открыть ссылку на гимн ↗</a>}</div>}{audioUrls.music&&<div className="ceremonyAudioCard"><b>Церемониальная музыка</b>{(!isExternalAudioLink(inauguration?.ceremonial_music_path)||isDirectAudioLink(audioUrls.music))&&<audio controls preload="none" src={audioUrls.music}/>} {isExternalAudioLink(inauguration?.ceremonial_music_path)&&<a href={audioUrls.music} target="_blank" rel="noopener noreferrer">Открыть ссылку на музыку ↗</a>}</div>}</div>}
   </section>
  </div>}
 </section>;
}
