'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {BookOpenText,ChevronDown,FilePlus2,Link2,Newspaper,Pencil,Plus,SlidersHorizontal,Trash2,Vote,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {BRAND_NAME} from '@/components/ui/BrandIdentity';
import type {ReturnTypeRepublic} from './viewTypes';
import {chatHandles} from './chatHandles';
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
import {POLITICAL_POST_BATCH_SIZE,nextPoliticalPostCount,visiblePoliticalPostCount} from './politicalWallPaging';
import {publishedStageReport} from './publishedStageReport';
import {formalDocumentTitle} from './formalInstitutions';
import {localizeAutomaticNewsText,localizeAutomaticNewsTag} from './automaticNewsLanguage';

const PROCESS_TYPES=[
 ['statement','Заявление'],['initiative','Инициатива'],['event','Событие'],
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
 const [actorSearch,setActorSearch]=useState('');
 useEffect(()=>{setServerActors(null);if(!game?.id||readOnly)return;let active=true;async function loadActors(){const r=await supabase.rpc('get_process_actors',{p_game_id:game!.id});if(active&&!r.error&&Array.isArray(r.data))setServerActors(r.data)}void loadActors();const timer=setInterval(()=>void loadActors(),30000);return()=>{active=false;clearInterval(timer)}},[game?.id,me?.user_id,me?.role_title,readOnly]);
 // The obsolete system publisher must not appear, even while RPC data loads.
 const actors=(readOnly?availableActors():serverActors??(me?[{key:'participant',label:me.full_name}]:[])).filter(x=>x.key!=='teacher'&&
  !/^(?:GOS\/\/SIMS|GOSSIMS)$/i.test(x.label.trim()));
 const actor=actors.find(x=>x.key===actorKey)||actors.find(x=>x.key==='participant')||actors[0];
 const actorSearchQuery=actorSearch.trim().toLocaleLowerCase('ru-RU');
 const searchedActors=actorSearchQuery
  ?actors.filter(a=>a.label.toLocaleLowerCase('ru-RU').includes(actorSearchQuery))
  :actors;
 const actorChoices=actor&&actorSearchQuery&&!searchedActors.some(a=>a.key===actor.key)
  ?[actor,...searchedActors]:searchedActors;
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[selectedTags,setSelectedTags]=useState<string[]>([]);
 const [externalUrl,setExternalUrl]=useState(''),[internalView,setInternalView]=useState(''),[formalIds,setFormalIds]=useState<string[]>([]);
 const [files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [search,setSearch]=useState(''),[filterActor,setFilterActor]=useState(''),[filterType,setFilterType]=useState(''),[filterStage,setFilterStage]=useState('');
 const [visiblePostCount,setVisiblePostCount]=useState(POLITICAL_POST_BATCH_SIZE);
 const [bulkMode,setBulkMode]=useState(false),[selectedPostIds,setSelectedPostIds]=useState<Set<string>>(()=>new Set()),[bulkProgress,setBulkProgress]=useState(0);
 const [locallyRemovedIds,setLocallyRemovedIds]=useState<Set<string>>(()=>new Set());
 // Bulk selection is local to one game. Never carry ids into another game.
 useEffect(()=>{setBulkMode(false);setSelectedPostIds(new Set());setBulkProgress(0);setLocallyRemovedIds(new Set())},[game?.id]);
 useEffect(()=>{
  const active=new Set(politicalPosts.map(post=>post.id));
  setSelectedPostIds(previous=>{
   if([...previous].every(id=>active.has(id)))return previous;
   return new Set([...previous].filter(id=>active.has(id)));
  });
 },[politicalPosts]);
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
  // Unmount a deleted post and its discussion immediately to avoid stale retry messages.
  if(locallyRemovedIds.has(p.id))return false;
  const q=search.trim().replace(/^#/,'').toLowerCase();
  if(q&&!([p.title,p.body,p.actor_label,...(p.tags||[]),...(p.source_key||p.context?.automatic===true||p.actor_key==='media'||p.process_type==='news'?[localizeAutomaticNewsText(p.title),localizeAutomaticNewsText(p.body),...(p.source_key||p.context?.automatic===true?(p.tags||[]).map(localizeAutomaticNewsTag):[])]:[])].join(' ').toLowerCase().includes(q)))return false;
  return (!filterActor||p.actor_key===filterActor)&&(!filterType||(filterType==='initiative'?['initiative','decision'].includes(p.process_type):p.process_type===filterType))&&(!filterStage||String(p.context?.stage_no)===filterStage);
 }).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Date.parse(b.created_at)-Date.parse(a.created_at)),[politicalPosts,locallyRemovedIds,search,filterActor,filterType,filterStage]);
 // Reset the window when the feed criteria change. Older posts and their interactive
 // widgets are mounted only when requested; the underlying game state is untouched.
 useEffect(()=>setVisiblePostCount(POLITICAL_POST_BATCH_SIZE),[game?.id,search,filterActor,filterType,filterStage]);
 const visiblePosts=useMemo(()=>filtered.slice(0,visiblePoliticalPostCount(filtered.length,visiblePostCount)),[filtered,visiblePostCount]);
 const bulkAllowed=teacher&&!readOnly;
 const allVisibleSelected=visiblePosts.length>0&&visiblePosts.every(p=>selectedPostIds.has(p.id));
 function toggleSelectedPost(id:string){
  if(!bulkAllowed||busy)return;
  setSelectedPostIds(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next});
 }
 function toggleVisibleSelection(){
  if(!bulkAllowed||busy)return;
  setSelectedPostIds(previous=>{const next=new Set(previous);for(const post of visiblePosts){if(allVisibleSelected)next.delete(post.id);else next.add(post.id)}return next});
 }
 function exitBulkMode(){if(busy)return;setBulkMode(false);setSelectedPostIds(new Set());setBulkProgress(0)}
 async function deleteSelectedPosts(){
  if(!bulkAllowed||!game||busy)return;
  const available=new Map(politicalPosts.map(post=>[post.id,post]));
  const ids=Array.from(selectedPostIds).filter(id=>available.has(id));
  if(!ids.length)return;
  const preview=ids.slice(0,3).map(id=>'• '+(available.get(id)?.title||'Публикация')).join('\n');
  if(!confirm('Удалить выбранные публикации ('+ids.length+')?\n\n'+preview+(ids.length>3?'\n… и ещё '+(ids.length-3):'')+'\n\nПубликации исчезнут из ленты. История изменений показателей сохранится.'))return;
  setBusy(true);setBulkProgress(0);setNotice('');
  setLocallyRemovedIds(previous=>new Set([...previous,...ids]));
  const failed:string[]=[];let succeeded=0;
  try{
   // Existing RPC checks server-side teacher rights and soft-deletes each post.
   // Limit simultaneous requests to avoid a burst against Supabase.
   for(let index=0;index<ids.length;index+=3){
    const batch=ids.slice(index,index+3);
    const results=await Promise.all(batch.map(async id=>{
     try{const {error}=await supabase.rpc('delete_process_post',{p_post_id:id});return {id,error:error?.message||''}}
     catch(error){return {id,error:error instanceof Error?error.message:'Ошибка подключения'}}
    }));
    for(const result of results){if(result.error)failed.push(result.id);else succeeded++}
    setBulkProgress(Math.min(index+batch.length,ids.length));
   }
   if(failed.length)setLocallyRemovedIds(previous=>{const next=new Set(previous);failed.forEach(id=>next.delete(id));return next});
   setSelectedPostIds(new Set(failed));
   if(!failed.length)setBulkMode(false);
   if(succeeded)await g.refresh();
   // Successful bulk deletion is silent; only actual failures show a notice.
   if(failed.length)setNotice('Не удалось удалить '+failed.length+' публикаций. Неудалённые записи снова показаны и оставлены выделенными.');
  }catch(error){
   setLocallyRemovedIds(previous=>{const next=new Set(previous);ids.forEach(id=>{if(failed.includes(id))next.delete(id)});return next});
   setNotice('Не удалось обновить ленту. Для проверки результата обновите раздел: '+(error instanceof Error?error.message:'неизвестная ошибка'));
  }finally{setBulkProgress(0);setBusy(false)}
 }

 const postMentionMatch=body.match(/(?:^|\\s)@([а-яёa-z0-9_-]*)$/i);
 const postQuery=(postMentionMatch?.[1]||'').toLocaleLowerCase('ru-RU');
 const postAddressees=chatHandles(g.members.filter(m=>m.game_id===g.game?.id&&m.user_id!==g.me?.user_id));
 const postMentionOptions=postMentionMatch?postAddressees.filter(x=>x.surname.toLocaleLowerCase('ru-RU').startsWith(postQuery)||x.handle.startsWith(postQuery)).slice(0,6):[];
 function insertPostMention(id:string){
  const chosen=postAddressees.find(x=>x.member.user_id===id);if(!chosen||!postMentionMatch)return;
  const duplicate=postAddressees.some(x=>x.member.user_id!==id&&x.surname.toLocaleLowerCase('ru-RU')===chosen.surname.toLocaleLowerCase('ru-RU'));
  const tag=chosen.surname+(duplicate?'_'+id.replace(/-/g,'').slice(0,8):'');
  setBody(body.slice(0,body.length-postMentionMatch[0].length)+(postMentionMatch[0].startsWith(' ')?' ':'')+'@'+tag+' ');
  requestAnimationFrame(()=>textInput.current?.focus());
 }
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
 async function deletePost(p:PoliticalPost){
  if(busy||!confirm('Удалить публикацию «'+p.title+'» из ленты? Зафиксированные изменения показателей сохранятся в истории.'))return;
  setBusy(true);setNotice('');
  setLocallyRemovedIds(previous=>new Set(previous).add(p.id));
  try{
   const {error}=await supabase.rpc('delete_process_post',{p_post_id:p.id});
   if(error)throw error;
   if(editing?.id===p.id)setEditing(null);
   await g.refresh();
  }catch(error){
   setLocallyRemovedIds(previous=>{const next=new Set(previous);next.delete(p.id);return next});
   setNotice(error instanceof Error?error.message:'Не удалось удалить публикацию.');
  }finally{setBusy(false)}
 }
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
 const composerParty=g.parties.find(p=>p.name===publisherLabel||actor?.key==='party:'+p.id||actor?.key==='faction:'+p.id);
 const mine=profiles.find(p=>p.user_id===me.user_id);
 return <div className="wallPage processPortal">
  <section className="wallHero">
   <div><small>Официальная лента игры</small><h1>Политический процесс</h1><p>События, документы и действия участников. Регистрация, смена этапов и итоги голосований появляются автоматически.</p></div>
   <div className="wallHeroStats"><div><strong>{politicalPosts.length}</strong><span>Публикаций в ленте</span></div><div><strong>{formalDocuments.length}</strong><span>Документов в реестре</span></div><div><strong>{votes.filter(v=>v.status==='open').length}</strong><span>Открытых голосований</span></div></div>
  </section>
  {!teacher&&!readOnly&&<section className="wallStageTask"><div className="wallStageTaskNo">{String(stageNo).padStart(2,'0')}</div><div className="wallStageTaskCopy"><small>Текущий этап</small><h2>{stageAction.title}</h2><p>{stageAction.body}</p></div><button className="primary" onClick={()=>onNavigate(stageAction.target)}>{stageAction.button}</button></section>}

  {!readOnly&&<details ref={composer} className="wallComposer surface">
   <summary><span className="processSummaryIcon"><Plus size={20}/></span><span><b>Создать публикацию</b><small>Текст, документы, медиа и голосование</small></span><ChevronDown size={20}/></summary>
   <div className="processComposerBody">
    <div className="wallComposerIdentity"><div className="wallAvatar"><PublisherAvatar actorKey={publisherKey} label={publisherLabel} partyLogo={composerParty?.logo_url} avatar={mine?.avatar_url} gender={mine?.gender}/></div><div className="wallActorPicker">
     {actors.length>12&&<label className="wallActorSearch">Поиск субъекта
      <input type="search" value={actorSearch} onChange={e=>setActorSearch(e.target.value)}
       placeholder="Министерство, партия, орган…" aria-label="Найти субъекта публикации"/>
     </label>}
     <StyledSelect label="Опубликовать от имени" value={actor?.key||''} onChange={setActorKey}
      options={actorChoices.map(a=>({value:a.key,label:a.label}))} wrap/>
    </div></div>
    <div className="wallComposerGrid"><StyledSelect label="Вид публикации" value={processType} onChange={setProcessType} options={PROCESS_TYPES.map(x=>({value:x[0],label:x[1]}))}/><label>Заголовок<input aria-label="Заголовок публикации" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Что произошло?"/></label></div>
    <label className="processTextField">Текст публикации<textarea ref={textInput} aria-label="Текст публикации" rows={5} value={body} onChange={e=>setBody(e.target.value)} placeholder="Опишите решение · @фамилия приглашает участника."/>{postMentionMatch&&<div className="civicMentionMenu" aria-label="Упоминание в публикации">{postMentionOptions.length?postMentionOptions.map(x=><button type="button" key={x.member.user_id} onClick={()=>insertPostMention(x.member.user_id)}>{x.member.full_name} · {x.member.role_title||'Участник'}</button>):<small>Участник не найден</small>}</div>}</label>
    <div className="processTagPicker"><span>Добавить тег в текст</span><div>{PROCESS_TAGS.map(t=><button key={t.key} type="button" aria-pressed={selectedTags.includes(t.key)} title={'#'+t.key} onClick={()=>addTag(t.key)}>{t.label}<small>#{t.key}</small></button>)}</div></div>
    <div className="processAttachmentTools"><MediaUploadButton files={files} onChange={setFiles} label="Фото, видео, аудио или файл" hint="До 12 вложений"/><FormalDocumentPicker documents={formalDocuments} value={formalIds} onChange={setFormalIds}/><button type="button" className="secondary" aria-expanded={linkOpen} onClick={()=>setLinkOpen(v=>!v)}><Link2 size={18}/>Ссылка в тексте</button></div>
    {linkOpen&&<div className="processInlineLinkEditor"><label>Текст ссылки<input value={linkLabel} onChange={e=>setLinkLabel(e.target.value)} placeholder="Название ресурса"/></label><StyledSelect label="Внутренний ресурс" value={linkView} onChange={setLinkView} options={[{value:'',label:'Внешняя ссылка'},...RESOURCE_VIEWS]}/>{!linkView&&<label>Адрес<input type="url" value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} placeholder="https://…"/></label>}<button type="button" className="secondary" onClick={insertLink} disabled={!linkLabel.trim()||(!linkView&&!/^https?:\/\/\S+$/.test(linkUrl.trim()))}>Вставить ссылку</button></div>}
    <details className="processExtraLinks"><summary>Дополнительная ссылка и голосование</summary><div><label>Внешний ресурс<input type="url" value={externalUrl} onChange={e=>setExternalUrl(e.target.value)} placeholder="https://…"/></label><StyledSelect label="Раздел игры" value={internalView} onChange={setInternalView} options={[{value:'',label:'Без ссылки'},...RESOURCE_VIEWS]}/><label className="processVoteCheck"><input type="checkbox" checked={createBallot} onChange={e=>setCreateBallot(e.target.checked)}/><span className="processVoteCheckIcon" aria-hidden="true"><Vote size={18}/></span><span className="processVoteCheckCopy"><b>Открыть голосование по публикации</b><small>После публикации сразу создать связанную процедуру голосования</small></span></label>{createBallot&&voteSettings}</div></details>
    <div className="wallComposerActions"><span>Публикацию увидят участники текущей игры.</span><div>{!teacher&&<button className="secondary" type="button" disabled={busy||!actor||title.trim().length<3||body.trim().length<3} onClick={()=>void submitNews()}><Newspaper size={18}/>Предложить новость в СМИ</button>}<button className="primary" disabled={busy||!actor||title.trim().length<3||body.trim().length<3} onClick={()=>void publish()}>{busy?'Сохраняется…':'Опубликовать'}</button></div></div>
   </div>
  </details>}
  {!readOnly&&<NewsProposals g={g} refreshKey={proposalRefresh} onOpenDocument={onOpenDocument} onNavigate={onNavigate} onPublished={title=>{setSearch(title);setNotice('Новость опубликована в СМИ.')}}/>}
  {notice&&<p className="processNotice" role="status">{notice}</p>}
  <>
   {bulkAllowed&&<section className="wallBulkControls" aria-label="Массовое удаление публикаций">
    <div className="wallBulkIntro"><strong>Публикации</strong><small>{bulkMode?'Отметьте публикации в ленте. Выбор сохраняется при раскрытии следующих постов.':'Управление выбранными публикациями'}</small></div>
    {!bulkMode
     ?<button type="button" className="secondary wallBulkToggle" disabled={busy} aria-pressed={false} onClick={()=>{setBulkMode(true);setNotice('')}}><Trash2 size={17}/>Массовое удаление</button>
     :<div className="wallBulkActions">
      <span className="wallBulkCount" role="status">Выбрано: {selectedPostIds.size}</span>
      <button type="button" className="secondary" disabled={busy||!visiblePosts.length} onClick={toggleVisibleSelection}>{allVisibleSelected?'Снять выбор с показанных':'Выбрать показанные'}</button>
      <button type="button" className="secondary" disabled={busy||!selectedPostIds.size} onClick={()=>setSelectedPostIds(new Set())}>Снять всё</button>
      <button type="button" className="wallBulkDelete" disabled={busy||!selectedPostIds.size} onClick={()=>void deleteSelectedPosts()}><Trash2 size={16}/>{busy?'Удаление '+bulkProgress+' из '+selectedPostIds.size:'Удалить выбранные ('+selectedPostIds.size+')'}</button>
      <button type="button" className="secondary" disabled={busy} onClick={exitBulkMode}>Отмена</button>
     </div>}
   </section>}
   <section className="wallSearch"><label>Поиск<input type="search" aria-label="Поиск публикаций" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Текст, название или тег"/></label><StyledSelect label="Субъект" value={filterActor} onChange={setFilterActor} options={[{value:'',label:'Все субъекты'},...Array.from(new Map(politicalPosts.map(p=>[p.actor_key,p.actor_key==='teacher'?BRAND_NAME:p.actor_label])).entries()).map(([value,label])=>({value,label}))]}/><StyledSelect label="Вид публикации" value={filterType} onChange={setFilterType} options={[{value:'',label:'Все публикации'},...PROCESS_TYPES.map(x=>({value:x[0],label:x[1]}))]}/><StyledSelect label="Этап" value={filterStage} onChange={setFilterStage} options={[{value:'',label:'Все этапы'},...g.stages.map(s=>({value:String(s.stage_no),label:'Этап '+s.stage_no+' · '+s.title}))]}/></section>
   <section className="wallFeed">{!filtered.length?<div className="emptyState">Подходящих публикаций нет.</div>:visiblePosts.map(p=>{
    const party=g.parties.find(x=>x.id===p.context?.party_id||x.name===p.actor_label||p.actor_key==='party:'+x.id||p.actor_key==='faction:'+x.id),pf=profiles.find(x=>x.user_id===p.author_id);
    const media=politicalMedia.filter(x=>x.post_id===p.id);
    const links=postFormalLinks.filter(x=>x.post_id===p.id).flatMap(x=>formalDocuments.filter(d=>d.id===x.formal_document_id));
    const vote=votes.find(v=>v.source_post_id===p.id||v.id===p.context?.vote_id);
    const registrationNews=p.source_key?.startsWith('media-party-registration:')&&party?.registration_status==='registered';
    const publicFiles=g.partyDocuments.filter(d=>p.context?.party_document_ids?.includes(d.id)&&d.url&&d.status==='accepted'&&
      (!registrationNews||['charter','program','symbol','congress_minutes'].includes(d.doc_kind)))
      .sort((a,b)=>Number(b.doc_kind==='program')-Number(a.doc_kind==='program')||a.doc_kind.localeCompare(b.doc_kind));
    const editorialFallback=publishedStageReport(p,formalDocuments,votes);
    const auto=!!p.source_key||p.context?.automatic===true;
    const stageLifecycleNotice=p.context?.source_table==='game_stages'&&p.source_key?.startsWith('stage:')&&!p.source_key.includes(':completed:');
    const publisherLabel=stageLifecycleNotice?BRAND_NAME:p.actor_key==='teacher'?BRAND_NAME:p.actor_label;
    const editorialPost=editorialFallback?{...p,...editorialFallback}:p;
    const newsPresentation=!stageLifecycleNotice&&(auto||p.actor_key==='media'||p.process_type==='news');
    const displayPost=newsPresentation?{...editorialPost,title:localizeAutomaticNewsText(editorialPost.title),body:localizeAutomaticNewsText(editorialPost.body)}:editorialPost;
    const label=publisherLabel,kind=stageLifecycleNotice?'Системное сообщение ГОС.ID':p.process_type==='decision'?'Инициатива':PROCESS_TYPES.find(x=>x[0]===p.process_type)?.[1]||'Публикация';
    const own=p.author_id===me.user_id,editable=!readOnly&&(teacher||own&&!auto);
    const canRequestVote=!readOnly&&(teacher||own&&!auto);
    return <article className={'wallPost '+p.status+(bulkMode&&bulkAllowed?' bulkSelecting':'')+(selectedPostIds.has(p.id)&&bulkMode&&bulkAllowed?' bulkSelected':'')+(!stageLifecycleNotice&&auto&&(p.context?.editorial_verified||editorialFallback)?' editorialStory':'')} key={p.id} id={'process-'+p.id}>
     <header>{bulkMode&&bulkAllowed&&<label className="wallBulkPostSelect" title={'Выбрать публикацию: '+p.title}><input type="checkbox" aria-label={'Выбрать публикацию: '+p.title} checked={selectedPostIds.has(p.id)} disabled={busy} onChange={()=>toggleSelectedPost(p.id)}/></label>}<div className="wallPostAvatar"><PublisherAvatar actorKey={stageLifecycleNotice?'teacher':p.actor_key} label={label} partyLogo={stageLifecycleNotice?undefined:party?.logo_url} avatar={stageLifecycleNotice?undefined:pf?.avatar_url} gender={stageLifecycleNotice?undefined:pf?.gender} name={stageLifecycleNotice?undefined:names[p.author_id]}/></div><div className="wallPostWho"><b>{label}</b><small>{stageLifecycleNotice?'Официальное уведомление платформы':auto?'Автоматическая публикация':p.actor_key==='participant'?names[p.author_id]||'Участник':'Официальное сообщение'} · <time dateTime={p.created_at}>{new Date(p.created_at).toLocaleString('ru-RU')}</time></small></div><span className={'postStatus '+p.status}>{p.status==='accepted'?'Принято':p.status==='rejected'?'Отклонено':'Опубликовано'}</span></header>
     {editing?.id===p.id&&<PostInlineEditor key={p.id} post={p} g={g} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setNotice('Изменения сохранены.')}}/>}
     <div className="wallPostBody"><div className="processPostMeta"><span>{kind}</span>{p.context?.stage_no&&<span>Этап {String(p.context.stage_no)}</span>}</div><h2>{displayPost.title}</h2>
      {!!p.comic_scene&&<div className="wallPostComic"><EventComic silent title={p.comic_scene.title||p.title} category={p.comic_scene.category||'Событие'} caseKey={p.comic_scene.case_key||p.internal_ref_id||p.id} scene={p.comic_scene}/></div>}
      {p.actor_key==='media'&&Array.isArray(p.context?.rating_changes)?<RatingNewsVisual g={g} post={p}/>:!media.some(m=>m.media_kind==='image')&&!p.comic_scene&&<div className="processSourceVisual"><div><PublisherAvatar actorKey={stageLifecycleNotice?'teacher':party?'party':p.actor_key} label={stageLifecycleNotice?BRAND_NAME:party?.name||label} partyLogo={stageLifecycleNotice?undefined:party?.logo_url} avatar={stageLifecycleNotice?undefined:pf?.avatar_url} gender={stageLifecycleNotice?undefined:pf?.gender}/></div><span><small>{links.length?'Связанные документы':kind}</small><b>{party?.name||label}</b>{!!p.context?.stage_title&&<small>{String(p.context.stage_title)}</small>}</span></div>}
      <PostText post={displayPost} onNavigate={onNavigate} onOpenDocument={onOpenDocument}/>
     </div>
     {media.length>0&&<div className="wallMedia">{media.map(m=>m.media_kind==='image'?<a className="processImageLink" key={m.id} href={m.url||'#'} target="_blank" rel="noreferrer"><img src={m.url||''} alt={m.file_name} loading="lazy" decoding="async"/></a>:m.media_kind==='video'?<video key={m.id} src={m.url||''} controls preload="metadata"/>:m.media_kind==='audio'?<div className="processAudio" key={m.id}><b>{m.file_name}</b><audio src={m.url||''} controls preload="metadata"/></div>:<a className="processFileLink" key={m.id} href={m.url||'#'} target="_blank" rel="noreferrer"><BookOpenText size={18}/><span>{m.file_name}</span></a>)}</div>}
     {publicFiles.length>0&&<div className="processPartyFiles"><h3>{registrationNews?'Опубликованные документы партии':'Документы партии'}</h3>{publicFiles.map(d=><a key={d.id} href={d.url!} target="_blank" rel="noopener noreferrer" className={registrationNews&&d.doc_kind==='program'?'processPartyProgram':''}><BookOpenText size={18}/><span><b>{registrationNews&&d.doc_kind==='program'?'Программа политической партии «'+(party?.name||'')+'»':d.doc_kind==='charter'?'Устав партии':d.doc_kind==='symbol'?'Символика партии':d.doc_kind==='congress_minutes'?'Протокол учредительного съезда':d.title}</b><small>{'Версия В'+(d.version_no??1)+' · '+d.file_name}</small></span></a>)}</div>}
     {links.length>0&&<div className="wallNpaLinks">{links.map(d=><button key={d.id} onClick={()=>onOpenDocument(d.id)}><BookOpenText size={19}/><span><small>{d.registry_no}</small><b>{formalDocumentTitle(d.title,d.doc_type)}</b></span><span className="processDocumentStatus">{d.status_label}</span></button>)}</div>}
     <PostChanges g={g} post={p}/>
     {!!p.tags?.length&&<div className="wallTags">{p.tags.map(t=><button key={t} onClick={()=>setSearch('#'+t)}>#{auto?localizeAutomaticNewsTag(t):t}</button>)}</div>}
     {(p.external_url||p.internal_view)&&<div className="wallLinks">{p.external_url&&<a href={p.external_url} target="_blank" rel="noreferrer"><Link2 size={16}/>Внешний ресурс</a>}{p.internal_view&&RESOURCE_VIEWS.some(v=>v.value===p.internal_view)&&<button onClick={()=>p.internal_view==='documents'&&p.internal_ref_id?onOpenDocument(p.internal_ref_id):onNavigate(p.internal_view as View)}><Link2 size={16}/>{RESOURCE_VIEWS.find(v=>v.value===p.internal_view)?.label}</button>}</div>}
     {vote&&<button className={'processLinkedVote '+vote.status} onClick={onOpenVotes}><span className="processLinkedVoteIcon" aria-hidden="true"><Vote size={21}/></span><span className="processLinkedVoteCopy"><small className="processLinkedVoteStatus">{vote.status==='open'?'Идёт голосование':'Голосование завершено'}</small><b className="processLinkedVoteTitle">{vote.title}</b></span><strong className="processLinkedVoteResult">{vote.status==='closed'?vote.result_label:'Открыть'}</strong></button>}
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
   {filtered.length>POLITICAL_POST_BATCH_SIZE&&<div className="wallFeedPaging" role="group" aria-label="Загрузка публикаций">
    <span role="status">Показано {visiblePosts.length} из {filtered.length} публикаций</span>
    {visiblePosts.length<filtered.length
     ?<button type="button" className="secondary wallFeedMore" onClick={()=>setVisiblePostCount(current=>nextPoliticalPostCount(current,filtered.length))}>Показать ещё {Math.min(POLITICAL_POST_BATCH_SIZE,filtered.length-visiblePosts.length)}<ChevronDown size={17}/></button>
     :<button type="button" className="secondary wallFeedMore" onClick={()=>setVisiblePostCount(POLITICAL_POST_BATCH_SIZE)}>Свернуть до 10<ChevronDown className="wallFeedCollapseIcon" size={17}/></button>}
   </div>}
  </>
  {metricPost&&<div className="eventCaseBackdrop processMetricBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setMetricPost(null)}}><section ref={metricDialog} className="eventCaseModal processMetricDialog" tabIndex={-1} role="dialog" aria-modal="true" aria-label="Показатели публикации"><header className="eventModalHeader"><div><small>Публикация</small><h3>{metricPost.title}</h3></div><button className="eventModalClose" aria-label="Закрыть редактор показателей" onClick={()=>setMetricPost(null)}><X size={20}/></button></header><div className="eventModalBody"><TeacherMetricStudio key={metricPost.id} g={g} postId={metricPost.id}/></div></section></div>}
 </div>;
}
