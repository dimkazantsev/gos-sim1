'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {BookOpenText,ChevronDown,FilePlus2,Link2,Newspaper,Pencil,Plus,SlidersHorizontal,Trash2,Vote,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import type {PoliticalPost,View} from './types';
import MediaUploadButton from './MediaUploadButton';
import FormalDocumentPicker from './FormalDocumentPicker';
import StyledSelect from '../ui/StyledSelect';
import {useDialog} from '../ui/useDialog';
import EventComic from './EventComic';
import PublisherAvatar from './PublisherAvatar';
import RichPostText from './RichPostText';
import TeacherMetricStudio from './TeacherMetricStudio';
import {PROCESS_TAGS} from './processTags';
import {VOTING_BODIES} from './votingBodies';
import {STAGE_ACTIONS} from './stageActions';
import PostChanges from './PostChanges';
import RatingNewsVisual from './RatingNewsVisual';
import CivicDiscussion from './CivicDiscussion';
import PostInlineEditor from './PostInlineEditor';
import NewsProposals from './NewsProposals';

const PROCESS_TYPES=[
 ['statement','Заявление'],['initiative','Инициатива'],['decision','Проект решения'],['event','Событие'],
 ['negotiation','Переговоры'],['crisis_response','Антикризисная мера'],['information','Информационное сообщение'],['news','Новость СМИ']
];
const RESOURCE_VIEWS:{value:View;label:string}[]=[
 {value:'actions',label:'Политический процесс'},{value:'documents',label:'Реестр НПА'},
 {value:'votes',label:'Голосования'},{value:'parties',label:'Партии'},{value:'stages',label:'Этапы'},
 {value:'events',label:'События'},{value:'dashboard',label:'Обзор игры'}
];
function PostText({post,onNavigate,onOpenDocument}:{post:PoliticalPost;onNavigate:(view:View)=>void;onOpenDocument:(id:string)=>void}){
 const [expanded,setExpanded]=useState(false);
 const long=post.body.length>800;
 const text=long&&!expanded?post.body.slice(0,700).replace(/\s+\S*$/,'')+'…':post.body;
 return <><RichPostText text={text} onNavigate={onNavigate} onOpenDocument={onOpenDocument}/>{long&&<button className="postReadMore" type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Свернуть текст':'Читать полностью'}<ChevronDown size={16}/></button>}</>;
}
export default function PoliticalWallView({g,onOpenVotes,onOpenDocument,onNavigate,focusPending=false,readOnly=false}:{g:ReturnTypeRepublic;onOpenVotes:()=>void;onOpenDocument:(id:string)=>void;onNavigate:(view:View)=>void;focusPending?:boolean;readOnly?:boolean}){
 const {game,me,teacher,currentStage,politicalPosts,politicalMedia,postFormalLinks,formalDocuments,votes,profiles,names,availableActors}=g;
 const [processType,setProcessType]=useState('statement'),[actorKey,setActorKey]=useState('');
 const [serverActors,setServerActors]=useState<{key:string;label:string}[]|null>(null);
 useEffect(()=>{if(!game?.id||readOnly)return;let active=true;async function loadActors(){const r=await supabase.rpc('get_process_actors',{p_game_id:game!.id});if(active&&!r.error&&Array.isArray(r.data))setServerActors(r.data)}void loadActors();const timer=setInterval(()=>void loadActors(),30000);return()=>{active=false;clearInterval(timer)}},[game?.id,me?.user_id,me?.role_title,readOnly]);
 const actors=serverActors||availableActors();
 const actor=actors.find(x=>x.key===actorKey)||(teacher?actors.find(x=>x.key==='teacher'):null)||actors[0];
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[selectedTags,setSelectedTags]=useState<string[]>([]);
 const [externalUrl,setExternalUrl]=useState(''),[internalView,setInternalView]=useState(''),[formalIds,setFormalIds]=useState<string[]>([]);
 const [files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [search,setSearch]=useState(''),[filterActor,setFilterActor]=useState(''),[filterType,setFilterType]=useState(''),[filterStage,setFilterStage]=useState('');
 const [editing,setEditing]=useState<PoliticalPost|null>(null);
 const [proposalRefresh,setProposalRefresh]=useState(0);
 const [linkOpen,setLinkOpen]=useState(false),[linkLabel,setLinkLabel]=useState(''),[linkUrl,setLinkUrl]=useState(''),[linkView,setLinkView]=useState('');
 const [voteFor,setVoteFor]=useState(''),[voteBody,setVoteBody]=useState('all'),[voteGroup,setVoteGroup]=useState(''),[createBallot,setCreateBallot]=useState(false);
 const [npaFor,setNpaFor]=useState(''),[npaType,setNpaType]=useState('fz_bill');
 const [metricPost,setMetricPost]=useState<PoliticalPost|null>(null);
 const metricDialog=useDialog(!!metricPost,()=>setMetricPost(null));
 const composer=useRef<HTMLDetailsElement>(null),textInput=useRef<HTMLTextAreaElement>(null);
 const groups=Array.from(new Set(g.members.filter(m=>m.kind==='student').map(m=>m.group_name).filter((x):x is string=>!!x))).sort();
 const selectedBody=VOTING_BODIES.find(x=>x.key===voteBody);
 const isGroupBody=voteBody==='government'||voteBody==='municipality';
 const filtered=useMemo(()=>politicalPosts.filter(p=>{
  const q=search.trim().replace(/^#/,'').toLowerCase();
  if(q&&!([p.title,p.body,p.actor_label,...(p.tags||[])].join(' ').toLowerCase().includes(q)))return false;
  return (!filterActor||p.actor_key===filterActor)&&(!filterType||p.process_type===filterType)&&(!filterStage||String(p.context?.stage_no)===filterStage);
 }).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Date.parse(b.created_at)-Date.parse(a.created_at)),[politicalPosts,search,filterActor,filterType,filterStage]);

 function insertText(text:string){
  const start=textInput.current?.selectionStart??body.length,end=textInput.current?.selectionEnd??body.length;
  setBody(body.slice(0,start)+text+body.slice(end));
  requestAnimationFrame(()=>{textInput.current?.focus();textInput.current?.setSelectionRange(start+text.length,start+text.length)});
 }
 function addTag(key:string){
  if(!selectedTags.includes(key))setSelectedTags(prev=>[...prev,key]);
  if(!body.includes('#'+key))insertText((body&&!/\s$/.test(body)?' ':'')+'#'+key+' ');
 }
 function insertLink(){
  const href=linkView?'gos:'+linkView:linkUrl.trim();
  if(!linkLabel.trim()||(!linkView&&!/^https?:\/\/\S+$/.test(href)))return;
  insertText('['+linkLabel.trim().replace(/[\[\]\n]/g,'')+']('+href+')');setLinkOpen(false);setLinkLabel('');setLinkUrl('');setLinkView('');
 }
 function clearDraft(){
  setTitle('');setBody('');setSelectedTags([]);setExternalUrl('');setInternalView('');setFormalIds([]);setFiles([]);setCreateBallot(false);setLinkOpen(false);
 }
 function editPost(p:PoliticalPost){
  setEditing(p);setNotice('');
 }
 async function publish(){
  if(!actor||!title.trim()||!body.trim()||busy)return;
  setBusy(true);setNotice('');
  try{
   const tags=Array.from(new Set([...selectedTags,...Array.from(body.matchAll(/#([а-яёa-z0-9_]+)/gi),m=>m[1])]));
   const data={processType,actorKey:actor.key,actorLabel:actor.label,title,body,tags,externalUrl,internalView,formalIds};
   const id=await g.createPoliticalPost(data,files);
   if(!id)return;
   if(createBallot){
    const ballot=await g.createVoteFromPost(id,voteBody,voteBody==='gd'?'mandate':'member',voteGroup);
    if(!ballot)setNotice('Публикация сохранена. Голосование не открыто; проверьте состав и права органа.');
    else setNotice('Публикация сохранена, голосование открыто.');
   }else setNotice('Публикация добавлена в ленту.');
   clearDraft();composer.current?.removeAttribute('open');
  }finally{setBusy(false)}
 }
 async function submitNews(){
  if(!actor||busy||!game||!me)return;setBusy(true);setNotice('');
  const uploadedPaths:string[]=[];let submitted=false;try{const attachments=[];for(const file of files){if(file.size>104857600){setNotice('Размер вложения превышает 100 МБ');return}const path=game.id+'/news/'+me.user_id+'/'+crypto.randomUUID()+'.'+(file.name.split('.').pop()||'bin');const r=await supabase.storage.from('game-assets').upload(path,file,{contentType:file.type||'application/octet-stream'});if(r.error){setNotice(r.error.message);return}uploadedPaths.push(path);attachments.push({storage_path:path,file_name:file.name,mime_type:file.type||null,file_size:file.size,media_kind:file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':file.type.startsWith('video/')?'video':'file'})}
   const r=await supabase.rpc('submit_media_news',{p_game_id:game.id,p_title:title,p_body:body,p_actor_key:actor.key,p_tags:Array.from(new Set([...selectedTags,...Array.from(body.matchAll(/#([а-яёa-z0-9_]+)/gi),m=>m[1])])),p_external_url:externalUrl.trim()||null,p_internal_view:internalView||null,p_formal_ids:formalIds,p_files:attachments});if(r.error){setNotice(r.error.message);return}submitted=true;setNotice('Новость направлена преподавателю на согласование.');setProposalRefresh(n=>n+1);clearDraft();composer.current?.removeAttribute('open');
  }catch(e){setNotice(e instanceof Error?e.message:'Не удалось направить новость')}finally{if(!submitted&&uploadedPaths.length)await supabase.storage.from('game-assets').remove(uploadedPaths);setBusy(false)}
 }
 async function deletePost(p:PoliticalPost){if(!confirm('Удалить публикацию «'+p.title+'» из ленты? Зафиксированные решения и изменения показателей сохранятся в истории.'))return;setBusy(true);const r=await supabase.rpc('delete_process_post',{p_post_id:p.id});if(r.error)setNotice(r.error.message);else{if(editing?.id===p.id)setEditing(null);await g.refresh();setNotice('Публикация удалена из ленты.')}setBusy(false)}
 async function startVote(postId:string){
  if(busy)return;setBusy(true);
  try{const id=await g.createVoteFromPost(postId,voteBody,voteBody==='gd'?'mandate':'member',voteGroup);if(id){setVoteFor('');onOpenVotes()}}finally{setBusy(false)}
 }
 async function quickNpa(p:PoliticalPost){
  const isBill=npaType==='fz_bill'||npaType==='fkz_bill';
  const subjectKey=isBill?'gd':npaType==='federal_budget'||npaType.startsWith('government_')?'government':npaType.startsWith('president_')?'president':npaType.startsWith('gd_')?'gd':npaType.startsWith('sf_')?'sf':npaType==='municipal_act'?'municipality':p.actor_key;
  const subjectLabel={gd:'Государственная Дума',sf:'Совет Федерации',president:'Президент Российской Федерации',government:'Правительство Российской Федерации',municipality:'Орган местного самоуправления'}[subjectKey as 'gd']||p.actor_label;
  const workflow=npaType==='federal_budget'?'budget':npaType.startsWith('president_')?'president_act':npaType.startsWith('government_')?'government_act':npaType==='gd_resolution'?'gd_resolution':npaType==='sf_resolution'?'sf_resolution':npaType==='municipal_act'?'municipal_act':'bill';
  setBusy(true);
  try{const id=await g.createFormalDocument({stageNo:currentStage?.stage_no||game?.current_round||1,title:p.title,docType:npaType,subjectKey,subjectLabel,bodyText:p.body,workflowKey:workflow,metadata:{source_post_id:p.id}});if(id){setNpaFor('');onOpenDocument(id)}}finally{setBusy(false)}
 }
 const voteSettings=<div className="processVoteSettings">
  <StyledSelect label="Кто голосует" value={voteBody} onChange={key=>{setVoteBody(key);setVoteGroup('')}} options={[{value:'all',label:'Все участники'},...(teacher?VOTING_BODIES.map(b=>({value:b.key,label:b.title})):[])]}/>
  {isGroupBody&&<StyledSelect label="Учебная группа" value={voteGroup} onChange={setVoteGroup} options={[{value:'',label:groups.length>1?'Выберите группу':'Вся игровая группа'},...groups.map(x=>({value:x,label:x}))]}/>}
  <p>{selectedBody?.basis||'Голосует каждый студент текущей игры. Кворум — две трети состава; решение — большинство присутствующих.'}</p>
 </div>;
 if(!game||!me)return null;
 const stageNo=currentStage?.stage_no||game.current_round||1,stageAction=STAGE_ACTIONS[stageNo]||STAGE_ACTIONS[1];
 const publisherKey=actor?.key||'participant',publisherLabel=actor?.label||me.full_name;
 const composerParty=g.parties.find(p=>p.name===publisherLabel);
 const mine=profiles.find(p=>p.user_id===me.user_id);
 return <div className="wallPage processPortal">
  <section className="wallHero">
   <div><small>Официальная лента игры</small><h1>Политический процесс</h1><p>События, документы и решения участников. Регистрация, смена этапов и итоги голосований появляются автоматически.</p></div>
   <div className="wallHeroStats"><div><strong>{politicalPosts.length}</strong><span>Публикаций в ленте</span></div><div><strong>{formalDocuments.length}</strong><span>Документов в реестре</span></div><div><strong>{votes.filter(v=>v.status==='open').length}</strong><span>Открытых голосований</span></div></div>
  </section>
  {!teacher&&!readOnly&&<section className="wallStageTask"><div className="wallStageTaskNo">{String(stageNo).padStart(2,'0')}</div><div className="wallStageTaskCopy"><small>Текущий этап</small><h2>{stageAction.title}</h2><p>{stageAction.body}</p></div><button className="primary" onClick={()=>onNavigate(stageAction.target)}>{stageAction.button}</button></section>}

  {!readOnly&&<details ref={composer} className="wallComposer surface">
   <summary><span className="processSummaryIcon"><Plus size={20}/></span><span><b>Создать публикацию</b><small>Текст, документы, медиа и голосование</small></span><ChevronDown size={20}/></summary>
   <div className="processComposerBody">
    <div className="wallComposerIdentity"><div className="wallAvatar"><PublisherAvatar actorKey={publisherKey} label={publisherLabel} partyLogo={composerParty?.logo_url} avatar={mine?.avatar_url} gender={mine?.gender}/></div><div><StyledSelect label="Опубликовать от имени" value={actor?.key||''} onChange={setActorKey} options={actors.map(a=>({value:a.key,label:a.label}))}/></div></div>
    <div className="wallComposerGrid"><StyledSelect label="Вид публикации" value={processType} onChange={setProcessType} options={PROCESS_TYPES.map(x=>({value:x[0],label:x[1]}))}/><label>Заголовок<input aria-label="Заголовок публикации" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Что произошло?"/></label></div>
    <label className="processTextField">Текст публикации<textarea ref={textInput} aria-label="Текст публикации" rows={5} value={body} onChange={e=>setBody(e.target.value)} placeholder="Опишите действие, участников, документ и результат."/></label>
    <div className="processTagPicker"><span>Добавить тег в текст</span><div>{PROCESS_TAGS.map(t=><button key={t.key} type="button" aria-pressed={selectedTags.includes(t.key)} title={'#'+t.key} onClick={()=>addTag(t.key)}>{t.label}<small>#{t.key}</small></button>)}</div></div>
    <div className="processAttachmentTools"><MediaUploadButton files={files} onChange={setFiles} label="Фото, видео, аудио или файл" hint="До 12 вложений"/><FormalDocumentPicker documents={formalDocuments} value={formalIds} onChange={setFormalIds}/><button type="button" className="secondary" aria-expanded={linkOpen} onClick={()=>setLinkOpen(v=>!v)}><Link2 size={18}/>Ссылка в тексте</button></div>
    {linkOpen&&<div className="processInlineLinkEditor"><label>Текст ссылки<input value={linkLabel} onChange={e=>setLinkLabel(e.target.value)} placeholder="Название ресурса"/></label><StyledSelect label="Внутренний ресурс" value={linkView} onChange={setLinkView} options={[{value:'',label:'Внешняя ссылка'},...RESOURCE_VIEWS]}/>{!linkView&&<label>Адрес<input type="url" value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} placeholder="https://…"/></label>}<button type="button" className="secondary" onClick={insertLink} disabled={!linkLabel.trim()||(!linkView&&!/^https?:\/\/\S+$/.test(linkUrl.trim()))}>Вставить ссылку</button></div>}
    <details className="processExtraLinks"><summary>Дополнительная ссылка и голосование</summary><div><label>Внешний ресурс<input type="url" value={externalUrl} onChange={e=>setExternalUrl(e.target.value)} placeholder="https://…"/></label><StyledSelect label="Раздел игры" value={internalView} onChange={setInternalView} options={[{value:'',label:'Без ссылки'},...RESOURCE_VIEWS]}/><label className="processVoteCheck"><input type="checkbox" checked={createBallot} onChange={e=>setCreateBallot(e.target.checked)}/><Vote size={18}/>Открыть голосование по публикации</label>{createBallot&&voteSettings}</div></details>
    <div className="wallComposerActions"><span>Публикацию увидят участники текущей игры.</span><div>{!teacher&&<button className="secondary" type="button" disabled={busy||!actor||title.trim().length<3||body.trim().length<3} onClick={()=>void submitNews()}><Newspaper size={18}/>Предложить новость в СМИ</button>}<button className="primary" disabled={busy||!actor||title.trim().length<3||body.trim().length<3} onClick={()=>void publish()}>{busy?'Сохраняется…':'Опубликовать'}</button></div></div>
   </div>
  </details>}
  {!readOnly&&<NewsProposals g={g} refreshKey={proposalRefresh} onOpenDocument={onOpenDocument} onNavigate={onNavigate} onPublished={title=>{setSearch(title);setNotice('Новость опубликована в СМИ.')}}/>}
  {notice&&<p className="processNotice" role="status">{notice}</p>}
  <>
   <section className="wallSearch"><label>Поиск<input type="search" aria-label="Поиск публикаций" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Текст, название или тег"/></label><StyledSelect label="Субъект" value={filterActor} onChange={setFilterActor} options={[{value:'',label:'Все субъекты'},...Array.from(new Map(politicalPosts.map(p=>[p.actor_key,p.actor_key==='teacher'?'GOS//SIMS':p.actor_label])).entries()).map(([value,label])=>({value,label}))]}/><StyledSelect label="Вид публикации" value={filterType} onChange={setFilterType} options={[{value:'',label:'Все публикации'},...PROCESS_TYPES.map(x=>({value:x[0],label:x[1]}))]}/><StyledSelect label="Этап" value={filterStage} onChange={setFilterStage} options={[{value:'',label:'Все этапы'},...g.stages.map(s=>({value:String(s.stage_no),label:'Этап '+s.stage_no+' · '+s.title}))]}/></section>
   <section className="wallFeed">{!filtered.length?<div className="emptyState">Подходящих публикаций нет.</div>:filtered.map(p=>{
    const party=g.parties.find(x=>x.id===p.context?.party_id||x.name===p.actor_label),pf=profiles.find(x=>x.user_id===p.author_id);
    const media=politicalMedia.filter(x=>x.post_id===p.id);
    const links=postFormalLinks.filter(x=>x.post_id===p.id).flatMap(x=>formalDocuments.filter(d=>d.id===x.formal_document_id));
    const vote=votes.find(v=>v.source_post_id===p.id||v.id===p.context?.vote_id);
    const publicFiles=g.partyDocuments.filter(d=>p.context?.party_document_ids?.includes(d.id)&&d.url);
    const label=p.actor_key==='teacher'?'GOS//SIMS':p.actor_label,kind=PROCESS_TYPES.find(x=>x[0]===p.process_type)?.[1]||'Публикация';
    const auto=!!p.source_key||p.context?.automatic===true;
    const own=p.author_id===me.user_id,editable=!readOnly&&(teacher||own&&!auto);
    const canRequestVote=!readOnly&&(teacher||own&&!auto);
    return <article className={'wallPost '+p.status} key={p.id} id={'process-'+p.id}>
     <header><div className="wallPostAvatar"><PublisherAvatar actorKey={p.actor_key} label={label} partyLogo={party?.logo_url} avatar={pf?.avatar_url} gender={pf?.gender} name={names[p.author_id]}/></div><div className="wallPostWho"><b>{label}</b><small>{auto?'Автоматическая публикация':p.actor_key==='participant'?names[p.author_id]||'Участник':'Официальное сообщение'} · <time dateTime={p.created_at}>{new Date(p.created_at).toLocaleString('ru-RU')}</time></small></div><span className={'postStatus '+p.status}>{p.status==='accepted'?'Принято':p.status==='rejected'?'Отклонено':'Опубликовано'}</span></header>
     {editing?.id===p.id&&<PostInlineEditor key={p.id} post={p} g={g} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setNotice('Изменения сохранены.')}}/>}
     <div className="wallPostBody"><div className="processPostMeta"><span>{kind}</span>{p.context?.stage_no&&<span>Этап {String(p.context.stage_no)}</span>}</div><h2>{p.title}</h2>
      {!!p.comic_scene&&<div className="wallPostComic"><EventComic silent title={p.comic_scene.title||p.title} category={p.comic_scene.category||'Событие'} caseKey={p.comic_scene.case_key||p.internal_ref_id||p.id} scene={p.comic_scene}/></div>}
      {p.actor_key==='media'&&Array.isArray(p.context?.rating_changes)?<RatingNewsVisual g={g} post={p}/>:!media.some(m=>m.media_kind==='image')&&!p.comic_scene&&<div className="processSourceVisual"><div><PublisherAvatar actorKey={party?'party':p.actor_key} label={party?.name||label} partyLogo={party?.logo_url} avatar={pf?.avatar_url} gender={pf?.gender}/></div><span><small>{links.length?'Документы и решения':kind}</small><b>{party?.name||label}</b>{!!p.context?.stage_title&&<small>{String(p.context.stage_title)}</small>}</span></div>}
      <PostText post={p} onNavigate={onNavigate} onOpenDocument={onOpenDocument}/>
     </div>
     {media.length>0&&<div className="wallMedia">{media.map(m=>m.media_kind==='image'?<a className="processImageLink" key={m.id} href={m.url||'#'} target="_blank" rel="noreferrer"><img src={m.url||''} alt={m.file_name} loading="lazy" decoding="async"/></a>:m.media_kind==='video'?<video key={m.id} src={m.url||''} controls preload="metadata"/>:m.media_kind==='audio'?<div className="processAudio" key={m.id}><b>{m.file_name}</b><audio src={m.url||''} controls preload="metadata"/></div>:<a className="processFileLink" key={m.id} href={m.url||'#'} target="_blank" rel="noreferrer"><BookOpenText size={18}/><span>{m.file_name}</span></a>)}</div>}
     {publicFiles.length>0&&<div className="processPartyFiles"><h3>Документы партии</h3>{publicFiles.map(d=><a key={d.id} href={d.url!} target="_blank" rel="noreferrer"><BookOpenText size={18}/><span>{d.title}<small>{d.file_name}</small></span></a>)}</div>}
     {links.length>0&&<div className="wallNpaLinks">{links.map(d=><button key={d.id} onClick={()=>onOpenDocument(d.id)}><BookOpenText size={19}/><span><small>{d.registry_no}</small><b>{d.title}</b></span><span className="processDocumentStatus">{d.status_label}</span></button>)}</div>}
     <PostChanges g={g} post={p}/>
     {!!p.tags?.length&&<div className="wallTags">{p.tags.map(t=><button key={t} onClick={()=>setSearch('#'+t)}>#{t}</button>)}</div>}
     {(p.external_url||p.internal_view)&&<div className="wallLinks">{p.external_url&&<a href={p.external_url} target="_blank" rel="noreferrer"><Link2 size={16}/>Внешний ресурс</a>}{p.internal_view&&RESOURCE_VIEWS.some(v=>v.value===p.internal_view)&&<button onClick={()=>p.internal_view==='documents'&&p.internal_ref_id?onOpenDocument(p.internal_ref_id):onNavigate(p.internal_view as View)}><Link2 size={16}/>{RESOURCE_VIEWS.find(v=>v.value===p.internal_view)?.label}</button>}</div>}
     {vote&&<button className={'wallVoteLink '+vote.status} onClick={onOpenVotes}><Vote size={22}/><span><small>{vote.status==='open'?'Идёт голосование':'Голосование завершено'}</small><b>{vote.title}</b></span><strong>{vote.status==='closed'?vote.result_label:'Открыть'}</strong></button>}
     {!readOnly&&<div className="wallPostActions">
      {!vote&&p.status==='published'&&canRequestVote&&<button onClick={()=>{setVoteFor(voteFor===p.id?'':p.id);setVoteBody('all');setVoteGroup('')}}><Vote size={17}/>Голосование</button>}
      <button onClick={()=>setNpaFor(npaFor===p.id?'':p.id)}><FilePlus2 size={17}/>Создать НПА</button>
      {editable&&<button onClick={()=>editPost(p)}><Pencil size={17}/>Редактировать</button>}
      {editable&&<MediaUploadButton files={[]} onChange={x=>{if(x.length)void g.addMediaToPoliticalPost(p.id,x)}} label="Добавить вложение" hint=""/>}
      {(teacher||own&&!auto)&&<button className="deletePost" disabled={busy} onClick={()=>void deletePost(p)}><Trash2 size={17}/>Удалить публикацию</button>}
      {teacher&&<button onClick={()=>setMetricPost(p)}><SlidersHorizontal size={17}/>Изменить показатели</button>}
     </div>}
     <CivicDiscussion kind="post" targetId={p.id} g={g} readOnly={readOnly}/>
     {voteFor===p.id&&<section className="processVoteComposer"><h3>Голосование по публикации</h3>{voteSettings}<button className="primary" disabled={busy||isGroupBody&&groups.length>1&&!voteGroup} onClick={()=>void startVote(p.id)}><Vote size={18}/>{busy?'Открывается…':'Открыть голосование'}</button></section>}
     {npaFor===p.id&&<div className="quickNpa"><StyledSelect label="Вид НПА" value={npaType} onChange={setNpaType} options={[{value:'fz_bill',label:'Проект ФЗ'},{value:'fkz_bill',label:'Проект ФКЗ'},{value:'federal_budget',label:'Федеральный бюджет'},{value:'president_decree',label:'Указ Президента'},{value:'government_resolution',label:'Постановление Правительства'},{value:'gd_resolution',label:'Постановление ГД'},{value:'sf_resolution',label:'Постановление СФ'},{value:'municipal_act',label:'Муниципальный акт'}]}/><button className="primary" disabled={busy} onClick={()=>void quickNpa(p)}>Создать проект из публикации</button></div>}
    </article>;
   })}</section>
  </>
  {metricPost&&<div className="eventCaseBackdrop processMetricBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setMetricPost(null)}}><section ref={metricDialog} className="eventCaseModal processMetricDialog" tabIndex={-1} role="dialog" aria-modal="true" aria-label="Показатели публикации"><header className="eventModalHeader"><div><small>Публикация</small><h3>{metricPost.title}</h3></div><button className="eventModalClose" aria-label="Закрыть редактор показателей" onClick={()=>setMetricPost(null)}><X size={20}/></button></header><div className="eventModalBody"><TeacherMetricStudio key={metricPost.id} g={g} postId={metricPost.id}/></div></section></div>}
 </div>;
}
