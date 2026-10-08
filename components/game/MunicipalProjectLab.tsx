'use client';
import {useEffect,useRef,useState} from 'react';
import StageModuleHeader from '../ui/StageModuleHeader';
import StyledSelect from '../ui/StyledSelect';
import {IconAction} from '../ui/IconAction';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './MunicipalStages.module.css';

type PresentationLink={name:string;url:string};
type Project={id:string;game_id:string;team_name:string|null;district_key:string|null;problem_title:string;location_text:string;problem_description:string;legal_competence:string;proposed_solution:string;estimated_cost:number;expected_effect:string;status:'fieldwork'|'draft'|'submitted'|'vote_open'|'adopted'|'rejected';vote_id:string|null;created_by:string;created_at:string;updated_at:string;submitted_at:string|null;presentation_links?:PresentationLink[]};
type ProjectMember={project_id:string;user_id:string};
type Evidence={id:string;project_id:string;uploaded_by:string;media_kind:'image'|'video'|'audio'|'file';storage_path:string;file_name:string;mime_type:string|null;file_size:number|null;note:string|null;created_at:string};
type District={id:string;district_key:string;title:string};

const statusLabel:Record<Project['status'],string>={fieldwork:'Полевое обследование',draft:'Проектируется',submitted:'На рассмотрении',vote_open:'Голосование',adopted:'Принят',rejected:'Отклонён'};
type ProjectDraft={administration:string;districtKey:string;problem:string;location:string;description:string;competence:string;solution:string;cost:string;effect:string;presentations:PresentationLink[]};
const emptyDraft=():ProjectDraft=>({administration:'',districtKey:'',problem:'',location:'',description:'',competence:'',solution:'',cost:'',effect:'',presentations:[]});
const projectDraft=(project:Project):ProjectDraft=>({administration:project.team_name||'',districtKey:project.district_key||'',problem:project.problem_title,location:project.location_text,description:project.problem_description,competence:project.legal_competence,solution:project.proposed_solution,cost:String(project.estimated_cost),effect:project.expected_effect,presentations:(project.presentation_links||[]).map(link=>({...link}))});
const maxPresentations=10;
export function validGooglePresentationUrl(value:string){
 const url=value.trim();
 if(url.length>2048||/[\u0000-\u0020\u007f\\<>]/.test(url))return false;
 if(!/^https:\/\/(?:(?:docs|slides)\.google\.com\/presentation\/d\/|slides\.google\.com\/d\/)(?:e\/)?[A-Za-z0-9_-]+(?:\/(?:edit|view|present|preview|embed|copy|pub|pubembed))?\/?(?:[?#][^\s<>]*)?$/.test(url))return false;
 try{const parsed=new URL(url);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.port&&(parsed.hostname==='docs.google.com'||parsed.hostname==='slides.google.com');}catch{return false;}
}
const presentationIssue=(link:PresentationLink)=>!link.name.trim()||link.name.trim().length>120||/[\u0000-\u001f\u007f]/.test(link.name)?'Укажите название презентации (до 120 символов).':!validGooglePresentationUrl(link.url)?'Нужна HTTPS-ссылка на презентацию Google: docs.google.com/presentation/d/… или slides.google.com.':'';

export default function MunicipalProjectLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,votes,setError}=g;
 const [projects,setProjects]=useState<Project[]>([]);
 const [projectMembers,setProjectMembers]=useState<ProjectMember[]>([]);
 const [evidence,setEvidence]=useState<Evidence[]>([]);
 const [districts,setDistricts]=useState<District[]>([]);
 const [urls,setUrls]=useState<Record<string,string>>({});
 const [selectedId,setSelectedId]=useState('');
 const [drafts,setDrafts]=useState<Record<string,ProjectDraft>>({new:emptyDraft()});
 const [memberToAdd,setMemberToAdd]=useState('');
 const [files,setFiles]=useState<File[]>([]);
 const [evidenceNote,setEvidenceNote]=useState('');
 const [busy,setBusy]=useState(false);
 const scopeKey=[game?.id,me?.user_id,me?.kind,me?.role_title,me?.roster_archived_at,teacher].join('|');
 const scope=useRef(scopeKey),generation=useRef(0),request=useRef(0),busyRef=useRef(false);
 const selectedRef=useRef(''),selectionTouched=useRef(false),dirtyDrafts=useRef(new Set<string>()),versions=useRef<Record<string,number>>({}),fileVersion=useRef(0);
 const [stateScope,setStateScope]=useState(scopeKey);
 scope.current=scopeKey;
 const renderGeneration=generation.current;
 useEffect(()=>{
  generation.current++;request.current++;busyRef.current=false;selectedRef.current='';selectionTouched.current=false;
  dirtyDrafts.current.clear();versions.current={};fileVersion.current++;
  setStateScope(scopeKey);setProjects([]);setProjectMembers([]);setEvidence([]);setDistricts([]);setUrls({});setSelectedId('');setDrafts({new:emptyDraft()});
  setMemberToAdd('');setFiles([]);setEvidenceNote('');setBusy(false);
  return()=>{generation.current++;request.current++;};
 },[scopeKey]);
 function pickProject(id:string){selectedRef.current=id;selectionTouched.current=true;setSelectedId(id);setMemberToAdd('');setFiles([]);setEvidenceNote('');fileVersion.current++;}
 function edit(patch:Partial<ProjectDraft>){
  const key=selectedRef.current||'new';dirtyDrafts.current.add(key);versions.current[key]=(versions.current[key]||0)+1;
  setDrafts(old=>({...old,[key]:{...(old[key]||emptyDraft()),...patch}}));
 }

 async function load(){
  if(!game||!me||me.roster_archived_at)return;
  const key=scopeKey,epoch=generation.current,sequence=++request.current;
  const current=()=>scope.current===key&&generation.current===epoch&&request.current===sequence;
  try{
  const [p,m,e,d]=await Promise.all([
   supabase.from('municipal_projects').select('*').eq('game_id',game.id).order('created_at',{ascending:true}),
   supabase.from('municipal_project_members').select('*').eq('game_id',game.id),
   supabase.from('municipal_project_evidence').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('municipal_districts').select('id,district_key,title').eq('game_id',game.id).order('title')
  ]);
  if(!current())return;
  const failure=[p,m,e,d].find(x=>x.error);if(failure?.error){setError(failure.error.message);return;}
   const rows=(e.data||[]) as Evidence[];
   const next:Record<string,string>={};
   await Promise.all(rows.map(async x=>{const s=await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600);if(!s.error&&s.data?.signedUrl)next[x.id]=s.data.signedUrl}));
   if(!current())return;
   const projectRows=(p.data||[]) as Project[];
   setProjects(projectRows);setProjectMembers((m.data||[]) as ProjectMember[]);setDistricts((d.data||[]) as District[]);setEvidence(rows);setUrls(next);
   setDrafts(old=>{const next={...old};for(const project of projectRows)if(!dirtyDrafts.current.has(project.id))next[project.id]=projectDraft(project);return next;});
   if(selectedRef.current&&!projectRows.some(project=>project.id===selectedRef.current))pickProject('');
   else if(!selectedRef.current&&!selectionTouched.current&&projectRows[0]){selectedRef.current=projectRows[0].id;setSelectedId(projectRows[0].id);}
  }catch(error){if(current())setError(error instanceof Error?error.message:String(error));}
 }
 useGameTableSync(game?.id,['municipal_projects','municipal_project_members','municipal_project_evidence','municipal_districts','game_votes'],load,scopeKey);

 const selected=projects.find(p=>p.id===selectedId);
 const draftKey=selectedId||'new',draft=drafts[draftKey]||emptyDraft();
 const {administration,districtKey,problem,location,description,competence,solution,cost,effect,presentations}=draft;
 const presentationErrors=presentations.map(presentationIssue);
 const canSave=problem.trim().length>=5&&location.trim().length>=3&&description.trim().length>=20&&competence.trim().length>=10&&solution.trim().length>=20&&effect.trim().length>=10&&Number.isFinite(Number(cost))&&Number(cost)>=0&&presentations.length<=maxPresentations&&presentationErrors.every(error=>!error);

 if(!game||!me||me.roster_archived_at||stateScope!==scopeKey)return null;
 const activeGame=game;
 const activeMe=me;
 const selectedMembers=selected?projectMembers.filter(x=>x.project_id===selected.id):[];
 const selectedEvidence=selected?evidence.filter(x=>x.project_id===selected.id):[];
 const imageCount=selectedEvidence.filter(x=>x.media_kind==='image').length;
 const videoCount=selectedEvidence.filter(x=>x.media_kind==='video').length;
 const fieldEvidenceReady=imageCount>=10&&videoCount>=5;
 const canEdit=!!selected&&(teacher||selected.created_by===activeMe.user_id||selectedMembers.some(x=>x.user_id===activeMe.user_id));
 const canManageMembers=!!selected&&(teacher||selected.created_by===activeMe.user_id);
 const memberName=(id:string)=>members.find(m=>m.user_id===id)?.full_name||'Участник';
 const vote=selected?.vote_id?votes.find(v=>v.id===selected.vote_id):undefined;
 const draftDirty=dirtyDrafts.current.has(draftKey);

 async function withBusy(action:(current:()=>boolean)=>Promise<void>){
  if(busyRef.current||scope.current!==scopeKey||generation.current!==renderGeneration)return;
  const key=scopeKey,epoch=generation.current,current=()=>scope.current===key&&generation.current===epoch;
  busyRef.current=true;setBusy(true);
  try{await action(current);}catch(error){if(current())setError(error instanceof Error?error.message:String(error));}
  finally{if(current()){busyRef.current=false;setBusy(false);}}
 }
 async function act(name:string,args:Record<string,unknown>,after?:(data:unknown)=>void){
  await withBusy(async current=>{const r=await supabase.rpc(name,args);if(!current())return;if(r.error)throw new Error(r.error.message);after?.(r.data);await load();});
 }

 async function save(newProject=false){
  if(!canSave||(selected&&(!canEdit||!['fieldwork','draft'].includes(selected.status))))return;
  const key=draftKey,version=versions.current[key]||0;
  await act('save_municipal_project_with_presentations',{p_game_id:activeGame.id,p_project_id:newProject?null:(selected?.id||null),p_team_name:administration.trim()||null,p_problem_title:problem.trim(),p_location_text:location.trim(),p_problem_description:description.trim(),p_legal_competence:competence.trim(),p_proposed_solution:solution.trim(),p_estimated_cost:Number(cost)||0,p_expected_effect:effect.trim(),p_presentation_links:presentations.map(link=>({name:link.name.trim(),url:link.url.trim()}))},data=>{
   const unchanged=(versions.current[key]||0)===version;
   if(unchanged)dirtyDrafts.current.delete(key);
   if(newProject&&data){
    const id=String(data);
    if(selectedRef.current===''){
     if(!unchanged){dirtyDrafts.current.add(id);versions.current[id]=versions.current[key]||0;setDrafts(old=>({...old,[id]:old.new,new:emptyDraft()}));dirtyDrafts.current.delete(key);}
     else setDrafts(old=>({...old,new:emptyDraft()}));
     selectedRef.current=id;setSelectedId(id);selectionTouched.current=true;
    }else if(unchanged)setDrafts(old=>({...old,new:emptyDraft()}));
   }
  });
 }
 async function setDistrict(){
  if(!selected||!canEdit||!['fieldwork','draft'].includes(selected.status)||!districtKey)return;
  await act('set_municipal_project_district',{p_project_id:selected.id,p_district_key:districtKey});
 }
 async function addMember(){if(!selected||!canManageMembers||!['fieldwork','draft'].includes(selected.status)||!memberToAdd)return;const id=selected.id,uid=memberToAdd;await act('add_municipal_project_member',{p_project_id:id,p_user_id:uid},()=>{if(selectedRef.current===id)setMemberToAdd(value=>value===uid?'':value);});}
 async function upload(){
  if(!selected||!canEdit||!['fieldwork','draft'].includes(selected.status)||files.length===0)return;
  const id=selected.id,version=fileVersion.current,failed:File[]=[];
  await withBusy(async current=>{
  for(const file of files){
   const ext=file.name.includes('.')?'.'+file.name.split('.').pop():'';
   if(!current())return;
   const path=activeGame.id+'/municipal/'+id+'/'+crypto.randomUUID()+ext;
   const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||undefined,upsert:false});
   if(!current())return;
   if(up.error){setError(up.error.message);failed.push(file);continue}
   const kind=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'file';
   const reg=await supabase.rpc('register_municipal_evidence',{p_project_id:id,p_media_kind:kind,p_storage_path:path,p_file_name:file.name,p_mime_type:file.type||null,p_file_size:file.size,p_note:evidenceNote.trim()||null});
   if(!current())return;
   if(reg.error){setError(reg.error.message);failed.push(file);}
  }
  if(selectedRef.current===id&&fileVersion.current===version){setFiles(failed);if(!failed.length)setEvidenceNote('');}
  await load();});
 }
 async function submit(){if(!selected||!canEdit||draftDirty||!fieldEvidenceReady||!selected.district_key||!['fieldwork','draft'].includes(selected.status))return;await act('submit_municipal_project',{p_project_id:selected.id});}
 async function openVote(){if(!selected||!teacher||selected.status!=='submitted')return;await act('open_municipal_project_vote',{p_project_id:selected.id});}

 return <section className={'municipalLab '+styles.panel}>
  <StageModuleHeader eyebrow="Полевое исследование · Этап 14" title="Городская проектная мастерская" description="Зафиксируйте наблюдаемую проблему и место, соберите доказательства, обоснуйте муниципальные полномочия. Затем предложите решение, оцените стоимость и ожидаемый эффект и представьте проект администрации." stats={[{label:'Муниципальные проекты',value:projects.length},{label:'Полевые материалы',value:imageCount+' фото · '+videoCount+' видео',detail:'Для рассмотрения: 10 фото и 5 видео'}]}/>
  <ol className={styles.steps} aria-label="Последовательность работы над проектом">{['Наблюдение','Доказательства','Компетенция','Проект','Решение'].map((step,index)=><li key={step}><b>{String(index+1).padStart(2,'0')}</b>{step}</li>)}</ol>

  <div className="municipalPicker"><div>{projects.map(p=><button key={p.id} className={p.id===selectedId?'active':''} aria-pressed={p.id===selectedId} onClick={()=>pickProject(p.id)}><b>{p.problem_title}</b><span>{p.location_text}</span><em>{statusLabel[p.status]}</em></button>)}</div><button onClick={()=>pickProject('')}>＋ Новый проект</button></div>

  {(!selected||canEdit)&&(!selected||['fieldwork','draft'].includes(selected.status))&&<div className="municipalEditor">
   <label>Подразделение администрации<input value={administration} onChange={e=>edit({administration:e.target.value})} placeholder="Необязательно"/></label>
   {selected&&<div className={styles.districtField}><StyledSelect wrap label="Район проекта" value={districtKey} onChange={value=>edit({districtKey:value})} disabled={busy} options={[{value:'',label:'Выберите район…'},...districts.map(d=>({value:d.district_key,label:d.title}))]}/><button type="button" className="municipalDistrictSave" disabled={busy||!districtKey} onClick={()=>void setDistrict()}>Закрепить район</button></div>}
   <label>Проблема<input value={problem} onChange={e=>edit({problem:e.target.value})} placeholder="Что именно не работает в городской среде?"/></label>
   <label>Место / адрес / зона<input value={location} onChange={e=>edit({location:e.target.value})} placeholder="Где наблюдается проблема?"/></label>
   <label className="wide">Описание наблюдаемой проблемы<textarea rows={4} value={description} onChange={e=>edit({description:e.target.value})} placeholder="Наблюдаемые факты, кто сталкивается с проблемой, масштаб, частота, последствия."/></label>
   <label className="wide">Компетенция местного уровня<textarea rows={3} value={competence} onChange={e=>edit({competence:e.target.value})} placeholder="Почему проблему вправе решать муниципальный орган? Укажите норму, полномочие или вопрос местного значения."/></label>
   <label className="wide">Предлагаемое решение<textarea rows={4} value={solution} onChange={e=>edit({solution:e.target.value})} placeholder="Что сделать, кто исполнитель, какие шаги и ресурсы нужны?"/></label>
   <label>Оценочная стоимость<input type="number" min="0" value={cost} onChange={e=>edit({cost:e.target.value})}/></label>
   <label>Ожидаемый эффект<input value={effect} onChange={e=>edit({effect:e.target.value})} placeholder="Как изменится ситуация и как это проверить?"/></label>
   <fieldset className={'wide '+styles.presentations}><legend>Презентации проекта</legend><p>До 10 ссылок на Google Презентации. У каждой ссылки — своё название. Откройте доступ для участников, которым предстоит рассматривать проект.</p>
    <div className={styles.presentationRows}>{presentations.map((link,index)=><div key={index} className={styles.presentationRow}>
     <label>Название презентации {index+1}<input value={link.name} maxLength={120} onChange={e=>edit({presentations:presentations.map((item,i)=>i===index?{...item,name:e.target.value}:item)})} placeholder="Например, обследование района"/></label>
     <label>Ссылка на презентацию {index+1}<input type="url" inputMode="url" value={link.url} maxLength={2048} aria-invalid={!!presentationErrors[index]} aria-describedby={presentationErrors[index]?'municipal-presentation-error-'+index:undefined} onChange={e=>edit({presentations:presentations.map((item,i)=>i===index?{...item,url:e.target.value}:item)})} placeholder="https://docs.google.com/presentation/d/…"/></label>
     <IconAction variant="remove" label={'Удалить презентацию '+(index+1)} onClick={()=>edit({presentations:presentations.filter((_,i)=>i!==index)})}/>
     {presentationErrors[index]&&<p className={styles.linkError} id={'municipal-presentation-error-'+index}>{presentationErrors[index]}</p>}
    </div>)}</div>
    <button type="button" disabled={presentations.length>=maxPresentations} onClick={()=>edit({presentations:[...presentations,{name:'',url:''}]})}>Добавить презентацию</button>
   </fieldset>
   <button className="primary wide" disabled={busy||!canSave} onClick={()=>void save(!selected)}>{selected?'Сохранить проект':'Создать проект'}</button>
  </div>}

  {selected&&<>
   <div className="municipalProjectSummary">
    <header><div><small>{selected.team_name||'Муниципальная администрация'}</small><h3>{selected.problem_title}</h3><p>{selected.location_text}{selected.district_key?' · '+(districts.find(d=>d.district_key===selected.district_key)?.title||selected.district_key):''}</p></div><span className={'municipalStatus '+selected.status}>{statusLabel[selected.status]}</span></header>
    <div className="municipalSummaryGrid"><article><small>ПРОБЛЕМА</small><p>{selected.problem_description}</p></article><article><small>КОМПЕТЕНЦИЯ</small><p>{selected.legal_competence}</p></article><article><small>РЕШЕНИЕ</small><p>{selected.proposed_solution}</p></article><article><small>ЭФФЕКТ И СТОИМОСТЬ</small><p>{selected.expected_effect}</p><strong>{Number(selected.estimated_cost).toLocaleString('ru-RU')}</strong></article></div>
   </div>

   {(selected.presentation_links||[]).some(link=>!presentationIssue(link))&&<section className={styles.savedPresentations} aria-label="Сохранённые презентации проекта"><h3>Презентации проекта</h3><ul>{(selected.presentation_links||[]).filter(link=>!presentationIssue(link)).map((link,index)=><li key={index}><a href={link.url.trim()} target="_blank" rel="noopener noreferrer">{link.name.trim()}</a></li>)}</ul></section>}

   <div className="municipalTeam"><div><small>СОСТАВ МУНИЦИПАЛЬНОЙ АДМИНИСТРАЦИИ</small><div>{selectedMembers.map(x=><span key={x.user_id}>{memberName(x.user_id)}</span>)}</div></div>{canManageMembers&&['fieldwork','draft'].includes(selected.status)&&<div><StyledSelect wrap label="Муниципальный служащий" value={memberToAdd} onChange={setMemberToAdd} disabled={busy} options={[{value:'',label:'Добавить в состав администрации…'},...members.filter(m=>m.kind==='student'&&!m.roster_archived_at&&!selectedMembers.some(x=>x.user_id===m.user_id)).map(m=>({value:m.user_id,label:m.full_name}))]}/><button disabled={busy||!memberToAdd} onClick={()=>void addMember()}>Добавить</button></div>}</div>

   <div className="municipalEvidence"><div className="municipalSectionTitle"><div><small>ПОЛЕВЫЕ ДОКАЗАТЕЛЬСТВА</small><h3>Не менее 10 фото и 5 видео</h3></div><span>{imageCount}/10 фото · {videoCount}/5 видео</span></div>
    <div className="municipalEvidenceGrid">{selectedEvidence.length===0?<div className="emptyState">Без доказательств проект нельзя отправить на рассмотрение.</div>:selectedEvidence.map(x=><article key={x.id}>{x.media_kind==='image'&&urls[x.id]?<img src={urls[x.id]} alt={x.note||x.file_name}/>:x.media_kind==='video'&&urls[x.id]?<video src={urls[x.id]} controls preload="metadata"/>:<div className="evidenceFile"><b>{x.media_kind==='audio'?'АУДИО':'ФАЙЛ'}</b><a href={urls[x.id]||'#'} target="_blank" rel="noopener noreferrer">{x.file_name}</a></div>}<footer><b>{x.file_name}</b>{x.note&&<p>{x.note}</p>}<span>{memberName(x.uploaded_by)} · {new Date(x.created_at).toLocaleString('ru-RU')}</span></footer></article>)}</div>
    {canEdit&&['fieldwork','draft'].includes(selected.status)&&<div className="municipalUpload"><input type="file" aria-label="Полевые материалы проекта" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx" onChange={e=>{fileVersion.current++;setFiles(Array.from(e.target.files||[]));}}/><input aria-label="Описание полевых материалов" value={evidenceNote} onChange={e=>{fileVersion.current++;setEvidenceNote(e.target.value);}} placeholder="Что подтверждает этот материал?"/><button disabled={busy||files.length===0} onClick={()=>void upload()}>Загрузить {files.length?'('+files.length+')':''}</button></div>}
   </div>

   <div className="municipalDecision"><div><small>ГОТОВНОСТЬ К ЗАСЕДАНИЮ</small><h3>{fieldEvidenceReady?'Полевой минимум выполнен':'Недостаточно полевых материалов'}</h3><p>{vote?('Связанное голосование: '+(vote.status==='open'?'открыто':vote.result_label||'закрыто')):'После отправки преподаватель может вынести проект на голосование администрации.'}</p></div>
    <div>{canEdit&&['fieldwork','draft'].includes(selected.status)&&<>{draftDirty&&<p className={styles.draftNotice}>Сохраните правки проекта перед отправкой на рассмотрение.</p>}<button className="primary" disabled={busy||draftDirty||!fieldEvidenceReady||!selected.district_key} onClick={()=>void submit()}>Отправить на рассмотрение</button></>}{teacher&&selected.status==='submitted'&&<button className="primary" disabled={busy} onClick={()=>void openVote()}>Открыть муниципальное голосование</button>}</div>
   </div>
  </>}
 </section>;
}
