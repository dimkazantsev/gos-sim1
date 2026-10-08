'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';

type Project={id:string;game_id:string;team_name:string|null;district_key:string|null;problem_title:string;location_text:string;problem_description:string;legal_competence:string;proposed_solution:string;estimated_cost:number;expected_effect:string;status:'fieldwork'|'draft'|'submitted'|'vote_open'|'adopted'|'rejected';vote_id:string|null;created_by:string;created_at:string;updated_at:string;submitted_at:string|null};
type ProjectMember={project_id:string;user_id:string};
type Evidence={id:string;project_id:string;uploaded_by:string;media_kind:'image'|'video'|'audio'|'file';storage_path:string;file_name:string;mime_type:string|null;file_size:number|null;note:string|null;created_at:string};
type District={id:string;district_key:string;title:string};

const statusLabel:Record<Project['status'],string>={fieldwork:'Полевое обследование',draft:'Проектируется',submitted:'На рассмотрении',vote_open:'Голосование',adopted:'Принят',rejected:'Отклонён'};

export default function MunicipalProjectLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,votes,setError}=g;
 const [projects,setProjects]=useState<Project[]>([]);
 const [projectMembers,setProjectMembers]=useState<ProjectMember[]>([]);
 const [evidence,setEvidence]=useState<Evidence[]>([]);
 const [districts,setDistricts]=useState<District[]>([]);
 const [urls,setUrls]=useState<Record<string,string>>({});
 const [selectedId,setSelectedId]=useState('');
 const [team,setTeam]=useState('');
 const [districtKey,setDistrictKey]=useState('');
 const [problem,setProblem]=useState('');
 const [location,setLocation]=useState('');
 const [description,setDescription]=useState('');
 const [competence,setCompetence]=useState('');
 const [solution,setSolution]=useState('');
 const [cost,setCost]=useState('');
 const [effect,setEffect]=useState('');
 const [memberToAdd,setMemberToAdd]=useState('');
 const [files,setFiles]=useState<File[]>([]);
 const [evidenceNote,setEvidenceNote]=useState('');
 const [busy,setBusy]=useState(false);
 const draftDirty=useRef(false),hydratedProject=useRef('');

 async function load(){
  if(!game)return;
  const [p,m,e,d]=await Promise.all([
   supabase.from('municipal_projects').select('*').eq('game_id',game.id).order('created_at',{ascending:true}),
   supabase.from('municipal_project_members').select('*').eq('game_id',game.id),
   supabase.from('municipal_project_evidence').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('municipal_districts').select('id,district_key,title').eq('game_id',game.id).order('title')
  ]);
  const failure=[p,m,e,d].find(x=>x.error);if(failure?.error){setError(failure.error.message);return;}
  if(!p.error){const rows=(p.data||[]) as Project[];setProjects(rows);if(!selectedId&&rows[0])setSelectedId(rows[0].id)}
  if(!m.error)setProjectMembers((m.data||[]) as ProjectMember[]);
  if(!d.error)setDistricts((d.data||[]) as District[]);
  if(!e.error){
   const rows=(e.data||[]) as Evidence[];setEvidence(rows);
   const next:Record<string,string>={};
   await Promise.all(rows.map(async x=>{const s=await supabase.storage.from('game-assets').createSignedUrl(x.storage_path,3600);if(!s.error&&s.data?.signedUrl)next[x.id]=s.data.signedUrl}));
   setUrls(next);
  }
 }
 useGameTableSync(game?.id,['municipal_projects','municipal_project_members','municipal_project_evidence','municipal_districts','game_votes'],load,me?.user_id||'');

 const selected=projects.find(p=>p.id===selectedId);
 useEffect(()=>{
  if(!selected)return;
  if(hydratedProject.current===selected.id&&draftDirty.current)return;
  hydratedProject.current=selected.id;draftDirty.current=false;
  setTeam(selected.team_name||'');setDistrictKey(selected.district_key||'');setProblem(selected.problem_title);setLocation(selected.location_text);setDescription(selected.problem_description);
  setCompetence(selected.legal_competence);setSolution(selected.proposed_solution);setCost(String(selected.estimated_cost));setEffect(selected.expected_effect);
 },[selected?.id,selected?.updated_at]);

 if(!game||!me)return null;
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

 async function save(newProject=false){
  if(problem.trim().length<5||location.trim().length<3||description.trim().length<20||competence.trim().length<10||solution.trim().length<20||effect.trim().length<10)return;
  setBusy(true);
  const r=await supabase.rpc('save_municipal_project',{p_game_id:activeGame.id,p_project_id:newProject?null:(selected?.id||null),p_team_name:team.trim()||null,p_problem_title:problem.trim(),p_location_text:location.trim(),p_problem_description:description.trim(),p_legal_competence:competence.trim(),p_proposed_solution:solution.trim(),p_estimated_cost:Number(cost)||0,p_expected_effect:effect.trim()});
  if(r.error)setError(r.error.message);else{draftDirty.current=false;if(newProject&&r.data)setSelectedId(String(r.data));await load()}setBusy(false);
 }
 async function setDistrict(){
  if(!selected||!districtKey)return;setBusy(true);const r=await supabase.rpc('set_municipal_project_district',{p_project_id:selected.id,p_district_key:districtKey});
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
  async function addMember(){if(!selected||!memberToAdd)return;setBusy(true);const r=await supabase.rpc('add_municipal_project_member',{p_project_id:selected.id,p_user_id:memberToAdd});if(r.error)setError(r.error.message);else{setMemberToAdd('');await load()}setBusy(false)}
 async function upload(){
  if(!selected||files.length===0)return;setBusy(true);
  for(const file of files){
   const ext=file.name.includes('.')?'.'+file.name.split('.').pop():'';
   const path=activeGame.id+'/municipal/'+selected.id+'/'+crypto.randomUUID()+ext;
   const up=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||undefined,upsert:false});
   if(up.error){setError(up.error.message);continue}
   const kind=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'file';
   const reg=await supabase.rpc('register_municipal_evidence',{p_project_id:selected.id,p_media_kind:kind,p_storage_path:path,p_file_name:file.name,p_mime_type:file.type||null,p_file_size:file.size,p_note:evidenceNote.trim()||null});
   if(reg.error)setError(reg.error.message);
  }
  setFiles([]);setEvidenceNote('');await load();setBusy(false);
 }
 async function submit(){if(!selected)return;setBusy(true);const r=await supabase.rpc('submit_municipal_project',{p_project_id:selected.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function openVote(){if(!selected)return;setBusy(true);const r=await supabase.rpc('open_municipal_project_vote',{p_project_id:selected.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}

 return <section className="municipalLab" onChangeCapture={()=>{draftDirty.current=true}}>
  <header className="municipalLabHead"><div><small>ПОЛЕВОЕ ИССЛЕДОВАНИЕ · ЭТАП 14</small><h2>Городская проектная мастерская</h2><p>Проект начинается не с решения, а с наблюдаемой проблемы. Зафиксируйте место и доказательства, покажите, почему вопрос относится к местному управлению, оцените стоимость и ожидаемый эффект — только после этого проект можно вынести на заседание.</p></div><div className="municipalSteps"><span><b>01</b>Наблюдение</span><span><b>02</b>Доказательства</span><span><b>03</b>Компетенция</span><span><b>04</b>Проект</span><span><b>05</b>Решение</span></div></header>

  <div className="municipalPicker"><div>{projects.map(p=><button key={p.id} className={p.id===selectedId?'active':''} onClick={()=>setSelectedId(p.id)}><b>{p.problem_title}</b><span>{p.location_text}</span><em>{statusLabel[p.status]}</em></button>)}</div><button onClick={()=>{setSelectedId('');setTeam('');setProblem('');setLocation('');setDescription('');setCompetence('');setSolution('');setCost('');setEffect('')}}>＋ Новый проект</button></div>

  {(!selected||canEdit)&&(!selected||['fieldwork','draft'].includes(selected.status))&&<div className="municipalEditor">
   <label>Название команды<input value={team} onChange={e=>setTeam(e.target.value)} placeholder="Необязательно"/></label>
   {selected&&<label>Район<select value={districtKey} onChange={e=>setDistrictKey(e.target.value)}><option value="">Выберите район…</option>{districts.map(d=><option key={d.id} value={d.district_key}>{d.title}</option>)}</select><button type="button" className="municipalDistrictSave" disabled={busy||!districtKey} onClick={()=>void setDistrict()}>Закрепить район</button></label>}
   <label>Проблема<input value={problem} onChange={e=>setProblem(e.target.value)} placeholder="Что именно не работает в городской среде?"/></label>
   <label>Место / адрес / зона<input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Где наблюдается проблема?"/></label>
   <label className="wide">Описание наблюдаемой проблемы<textarea rows={4} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Наблюдаемые факты, кто сталкивается с проблемой, масштаб, частота, последствия."/></label>
   <label className="wide">Компетенция местного уровня<textarea rows={3} value={competence} onChange={e=>setCompetence(e.target.value)} placeholder="Почему проблему вправе решать муниципальный орган? Укажите норму, полномочие или вопрос местного значения."/></label>
   <label className="wide">Предлагаемое решение<textarea rows={4} value={solution} onChange={e=>setSolution(e.target.value)} placeholder="Что сделать, кто исполнитель, какие шаги и ресурсы нужны?"/></label>
   <label>Оценочная стоимость<input type="number" min="0" value={cost} onChange={e=>setCost(e.target.value)}/></label>
   <label>Ожидаемый эффект<input value={effect} onChange={e=>setEffect(e.target.value)} placeholder="Как изменится ситуация и как это проверить?"/></label>
   <button className="primary wide" disabled={busy} onClick={()=>void save(!selected)}>{selected?'Сохранить проект':'Создать проект'}</button>
  </div>}

  {selected&&<>
   <div className="municipalProjectSummary">
    <header><div><small>{selected.team_name||'Проектная команда'}</small><h3>{selected.problem_title}</h3><p>{selected.location_text}{selected.district_key?' · '+(districts.find(d=>d.district_key===selected.district_key)?.title||selected.district_key):''}</p></div><span className={'municipalStatus '+selected.status}>{statusLabel[selected.status]}</span></header>
    <div className="municipalSummaryGrid"><article><small>ПРОБЛЕМА</small><p>{selected.problem_description}</p></article><article><small>КОМПЕТЕНЦИЯ</small><p>{selected.legal_competence}</p></article><article><small>РЕШЕНИЕ</small><p>{selected.proposed_solution}</p></article><article><small>ЭФФЕКТ И СТОИМОСТЬ</small><p>{selected.expected_effect}</p><strong>{Number(selected.estimated_cost).toLocaleString('ru-RU')}</strong></article></div>
   </div>

   <div className="municipalTeam"><div><small>КОМАНДА</small><div>{selectedMembers.map(x=><span key={x.user_id}>{memberName(x.user_id)}</span>)}</div></div>{canManageMembers&&['fieldwork','draft'].includes(selected.status)&&<div><select value={memberToAdd} onChange={e=>setMemberToAdd(e.target.value)}><option value="">Добавить участника…</option>{members.filter(m=>m.kind==='student'&&!selectedMembers.some(x=>x.user_id===m.user_id)).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select><button disabled={busy||!memberToAdd} onClick={()=>void addMember()}>Добавить</button></div>}</div>

   <div className="municipalEvidence"><div className="municipalSectionTitle"><div><small>ПОЛЕВЫЕ ДОКАЗАТЕЛЬСТВА</small><h3>Не менее 10 фото и 5 видео</h3></div><span>{imageCount}/10 фото · {videoCount}/5 видео</span></div>
    <div className="municipalEvidenceGrid">{selectedEvidence.length===0?<div className="emptyState">Без доказательств проект нельзя отправить на рассмотрение.</div>:selectedEvidence.map(x=><article key={x.id}>{x.media_kind==='image'&&urls[x.id]?<img src={urls[x.id]} alt={x.note||x.file_name}/>:x.media_kind==='video'&&urls[x.id]?<video src={urls[x.id]} controls preload="metadata"/>:<div className="evidenceFile"><b>{x.media_kind==='audio'?'AUDIO':'FILE'}</b><a href={urls[x.id]||'#'} target="_blank" rel="noreferrer">{x.file_name}</a></div>}<footer><b>{x.file_name}</b>{x.note&&<p>{x.note}</p>}<span>{memberName(x.uploaded_by)} · {new Date(x.created_at).toLocaleString('ru-RU')}</span></footer></article>)}</div>
    {canEdit&&['fieldwork','draft'].includes(selected.status)&&<div className="municipalUpload"><input type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx" onChange={e=>setFiles(Array.from(e.target.files||[]))}/><input value={evidenceNote} onChange={e=>setEvidenceNote(e.target.value)} placeholder="Что подтверждает этот материал?"/><button disabled={busy||files.length===0} onClick={()=>void upload()}>Загрузить {files.length?'('+files.length+')':''}</button></div>}
   </div>

   <div className="municipalDecision"><div><small>ГОТОВНОСТЬ К ЗАСЕДАНИЮ</small><h3>{fieldEvidenceReady?'Полевой минимум выполнен':'Недостаточно полевых материалов'}</h3><p>{vote?('Связанное голосование: '+(vote.status==='open'?'открыто':vote.result_label||'закрыто')):'После отправки преподаватель может вынести проект на голосование администрации.'}</p></div>
    <div>{canEdit&&['fieldwork','draft'].includes(selected.status)&&<button className="primary" disabled={busy||!fieldEvidenceReady||!selected.district_key} onClick={()=>void submit()}>Отправить на рассмотрение</button>}{teacher&&selected.status==='submitted'&&<button className="primary" disabled={busy} onClick={()=>void openVote()}>Открыть муниципальное голосование</button>}</div>
   </div>
  </>}
 </section>;
}
