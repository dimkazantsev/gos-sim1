'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {PoliticalPost,View} from './types';

const PROCESS_TYPES=[
 ['statement','Заявление'],['initiative','Инициатива'],['decision','Проект решения'],['event','Событие'],
 ['negotiation','Переговоры'],['crisis_response','Антикризисная мера'],['information','Информационное сообщение']
];

function PostImpactEditor({g,post}:{g:ReturnTypeRepublic;post:PoliticalPost}){
 const [deltas,setDeltas]=useState<Record<string,number>>(
  Object.fromEntries(g.metrics.map(m=>[m.metric_key,Number(post.impact_plan?.metrics?.[m.metric_key]||0)]))
 );
 const [partyDeltas,setPartyDeltas]=useState<Record<string,number>>(
  Object.fromEntries(g.parties.map(p=>[p.id,Number(post.impact_plan?.party_support?.[p.id]||0)]))
 );
 const [busy,setBusy]=useState(false);
 async function save(apply=false){
  setBusy(true);
  const plan={metrics:Object.fromEntries(Object.entries(deltas).filter(([,v])=>v!==0)),party_support:Object.fromEntries(Object.entries(partyDeltas).filter(([,v])=>v!==0))};
  if(apply)await g.acceptPoliticalPost(post.id,plan);else await g.approvePostImpact(post.id,plan);
  setBusy(false);
 }
 return <details className="impactEditor">
  <summary>⚙ Последствия и рейтинги</summary>
  <div className="impactEditorBody">
   <div><small>ПОКАЗАТЕЛИ ГОСУДАРСТВА</small>{g.metrics.map(m=><label key={m.id}><span>{m.label}</span><input type="number" min="-100" max="100" value={deltas[m.metric_key]||0} onChange={e=>setDeltas(x=>({...x,[m.metric_key]:Number(e.target.value)||0}))}/><em>{m.unit||''}</em></label>)}</div>
   <div><small>ПОДДЕРЖКА ПАРТИЙ</small>{g.parties.map(p=><label key={p.id}><span>{p.name}</span><input type="number" min="-100" max="100" value={partyDeltas[p.id]||0} onChange={e=>setPartyDeltas(x=>({...x,[p.id]:Number(e.target.value)||0}))}/><em>п.п.</em></label>)}</div>
  </div>
  <div className="impactEditorActions"><button className="secondary" disabled={busy} onClick={()=>void save(false)}>Сохранить последствия</button>{post.status==='published'&&<button className="primary" disabled={busy} onClick={()=>void save(true)}>Принять как решение и применить</button>}</div>
 </details>
}

export default function PoliticalWallView({g,onOpenVotes,onOpenDocument,onNavigate}:{g:ReturnTypeRepublic;onOpenVotes:()=>void;onOpenDocument:(id:string)=>void;onNavigate:(view:View)=>void}){
 const {game,me,teacher,politicalPosts,politicalMedia,postFormalLinks,politicalDecisions,formalDocuments,votes,profiles,names,availableActors,createPoliticalPost,acceptPoliticalPost,rejectPoliticalPost,createVoteFromPost,createFormalDocument}=g;
 const [tab,setTab]=useState<'feed'|'registry'>('feed');
 const [processType,setProcessType]=useState('statement'),[actorKey,setActorKey]=useState('participant');
 const actors=availableActors();
 const actor=actors.find((x:{key:string;label:string})=>x.key===actorKey)||actors[0];
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[tagText,setTagText]=useState('');
 const [externalUrl,setExternalUrl]=useState(''),[internalView,setInternalView]=useState(''),[formalIds,setFormalIds]=useState<string[]>([]);
 const [files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false);
 const [search,setSearch]=useState(''),[filterActor,setFilterActor]=useState(''),[filterType,setFilterType]=useState('');
 const [npaFor,setNpaFor]=useState(''),[npaType,setNpaType]=useState('fz_bill');

 const filtered=useMemo(()=>politicalPosts.filter(p=>{
  const q=search.trim().toLowerCase();
  if(q&&!([p.title,p.body,p.actor_label,...(p.tags||[])].join(' ').toLowerCase().includes(q)))return false;
  if(filterActor&&p.actor_key!==filterActor)return false;
  if(filterType&&p.process_type!==filterType)return false;
  return true;
 }),[politicalPosts,search,filterActor,filterType]);

 async function publish(){
  if(!actor||!title.trim()||!body.trim())return;
  setBusy(true);
  const tags=Array.from(new Set(tagText.split(/[\s,]+/).map(x=>x.trim().replace(/^#/,'')).filter(Boolean)));
  const id=await createPoliticalPost({processType,actorKey:actor.key,actorLabel:actor.label,title,body,tags,externalUrl,internalView,formalIds},files);
  setBusy(false);
  if(id){setTitle('');setBody('');setTagText('');setExternalUrl('');setInternalView('');setFormalIds([]);setFiles([])}
 }
 async function startVote(postId:string){
  const id=await createVoteFromPost(postId,'all','member');if(id)onOpenVotes();
 }
 async function quickNpa(p:PoliticalPost){
  const isBill=npaType==='fz_bill'||npaType==='fkz_bill';
  const subjectKey=isBill?'gd':p.actor_key;
  const subjectLabel=isBill?'Государственная Дума':p.actor_label;
  const workflow=npaType==='federal_budget'?'budget':npaType==='president_decree'||npaType==='president_order'?'president_act':npaType==='government_resolution'||npaType==='government_order'?'government_act':npaType==='gd_resolution'?'gd_resolution':npaType==='sf_resolution'?'sf_resolution':npaType==='municipal_act'?'municipal_act':'bill';
  setBusy(true);
  const id=await createFormalDocument({stageNo:g.currentStage?.stage_no||game?.current_round||1,title:p.title,docType:npaType,subjectKey,subjectLabel,bodyText:p.body,workflowKey:workflow,metadata:{source_post_id:p.id}});
  setBusy(false);
  if(id){setNpaFor('');onOpenDocument(id)}
 }
 if(!game||!me)return null;

 return <div className="wallPage">
  <section className="wallHero">
   <div><small>ОФИЦИАЛЬНАЯ ЛЕНТА ИГРЫ</small><h1>Политические процессы</h1><p>Публикации органов власти, партий, должностных лиц, СМИ и участников. Пост может стать решением, НПА или предметом голосования.</p></div>
   <div className="wallHeroStats"><div><strong>{politicalPosts.length}</strong><span>публикаций</span></div><div><strong>{politicalDecisions.length}</strong><span>решений</span></div><div><strong>{votes.filter(v=>v.status==='open').length}</strong><span>голосований</span></div></div>
  </section>

  <section className="wallComposer surface">
   <div className="wallComposerIdentity">
    <div className="wallAvatar">{me.full_name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()}</div>
    <div><small>ПУБЛИКАЦИЯ ОТ ИМЕНИ</small><select value={actorKey} onChange={e=>setActorKey(e.target.value)}>{actors.map((a:{key:string;label:string})=><option key={a.key} value={a.key}>{a.label}</option>)}</select></div>
   </div>
   <div className="wallComposerGrid">
    <select value={processType} onChange={e=>setProcessType(e.target.value)}>{PROCESS_TYPES.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select>
    <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Заголовок политического процесса"/>
   </div>
   <textarea rows={5} value={body} onChange={e=>setBody(e.target.value)} placeholder="Что произошло, что предлагается, кто действует и к каким последствиям это должно привести?"/>
   <div className="wallAttachGrid">
    <label># Теги<input value={tagText} onChange={e=>setTagText(e.target.value)} placeholder="президентрф гдрф экономика"/></label>
    <label>Внешняя ссылка<input value={externalUrl} onChange={e=>setExternalUrl(e.target.value)} placeholder="https://…"/></label>
    <label>Внутренняя ссылка<select value={internalView} onChange={e=>setInternalView(e.target.value)}><option value="">Нет</option><option value="votes">Голосования</option><option value="documents">НПА</option><option value="parties">Партии</option><option value="stages">Этапы</option></select></label>
    <label>Медиа<input type="file" multiple accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt" onChange={e=>setFiles(Array.from(e.target.files||[]))}/></label>
   </div>
   <details className="wallFormalAttach"><summary>▤ Прикрепить НПА <span>{formalIds.length||''}</span></summary><div>{formalDocuments.length===0?<p>НПА ещё нет.</p>:formalDocuments.map(d=><label key={d.id}><input type="checkbox" checked={formalIds.includes(d.id)} onChange={e=>setFormalIds(x=>e.target.checked?[...x,d.id]:x.filter(id=>id!==d.id))}/><span><b>{d.registry_no}</b>{d.title}</span></label>)}</div></details>
   {files.length>0&&<div className="wallSelectedFiles">{files.map(f=><span key={f.name}>{f.name}</span>)}</div>}
   <div className="wallComposerActions"><span>Публикация станет частью официального журнала игры.</span><button className="primary" disabled={busy||!title.trim()||!body.trim()} onClick={publish}>{busy?'Публикую…':'Опубликовать'}</button></div>
  </section>

  <div className="wallTabs"><button className={tab==='feed'?'active':''} onClick={()=>setTab('feed')}>Лента</button><button className={tab==='registry'?'active':''} onClick={()=>setTab('registry')}>Реестр принятых решений <span>{politicalDecisions.length}</span></button></div>

  {tab==='feed'&&<>
   <section className="wallSearch"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="⌕ Поиск по публикациям, тексту и тегам"/><select value={filterActor} onChange={e=>setFilterActor(e.target.value)}><option value="">Все субъекты</option>{Array.from(new Map(politicalPosts.map(p=>[p.actor_key,p.actor_label])).entries()).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select><select value={filterType} onChange={e=>setFilterType(e.target.value)}><option value="">Все процессы</option>{PROCESS_TYPES.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></section>
   <section className="wallFeed">{filtered.length===0?<div className="emptyState">Подходящих публикаций нет.</div>:filtered.map(p=>{
    const pf=profiles.find(x=>x.user_id===p.author_id);
    const media=politicalMedia.filter(x=>x.post_id===p.id);
    const links=postFormalLinks.filter(x=>x.post_id===p.id).map(x=>formalDocuments.find(d=>d.id===x.formal_document_id)).filter(Boolean);
    const vote=votes.find(v=>v.source_post_id===p.id);
    return <article className={'wallPost '+p.status} key={p.id}>
     <header><div className="wallPostAvatar">{pf?.avatar_url?<img src={pf.avatar_url} alt=""/>:<span>{p.actor_label.slice(0,2).toUpperCase()}</span>}</div><div className="wallPostWho"><b>{p.actor_label}</b><small>{names[p.author_id]||'Участник'} · {new Date(p.created_at).toLocaleString('ru-RU')}</small></div><span className={'postStatus '+p.status}>{p.status==='accepted'?'✓ ПРИНЯТО':p.status==='rejected'?'× ОТКЛОНЕНО':'ОПУБЛИКОВАНО'}</span></header>
     <div className="wallPostBody"><small>{PROCESS_TYPES.find(x=>x[0]===p.process_type)?.[1]||p.process_type}</small><h2>{p.title}</h2><p>{p.body}</p></div>
     {!!p.tags?.length&&<div className="wallTags">{p.tags.map(t=><button key={t} onClick={()=>setSearch('#'+t)}>#{t}</button>)}</div>}
     {media.length>0&&<div className={'wallMedia '+(media.length>1?'multi':'')}>{media.map(m=>m.media_kind==='image'?<img key={m.id} src={m.url||''} alt={m.file_name}/>:m.media_kind==='video'?<video key={m.id} src={m.url||''} controls/>:m.media_kind==='audio'?<audio key={m.id} src={m.url||''} controls/>:<a key={m.id} href={m.url||'#'} target="_blank" rel="noreferrer">▤ {m.file_name}</a>)}</div>}
     {(p.external_url||p.internal_view)&&<div className="wallLinks">{p.external_url&&<a href={p.external_url} target="_blank" rel="noreferrer">↗ Внешняя ссылка</a>}{p.internal_view&&<button onClick={()=>onNavigate(p.internal_view as View)}>↳ Внутри GOS//SIM: {p.internal_view}</button>}</div>}
     {links.length>0&&<div className="wallNpaLinks">{links.map((d:any)=><button key={d.id} onClick={()=>onOpenDocument(d.id)}><small>НПА</small><b>{d.registry_no}</b><span>{d.title}</span></button>)}</div>}
     {vote&&<button className={'wallVoteLink '+vote.status} onClick={onOpenVotes}><span>✓</span><div><small>{vote.status==='open'?'ИДЁТ ГОЛОСОВАНИЕ':'ГОЛОСОВАНИЕ ЗАВЕРШЕНО'}</small><b>{vote.title}</b></div><strong>{vote.status==='closed'?vote.result_label:'Открыть →'}</strong></button>}
     <div className="wallPostActions">
      {!vote&&p.status==='published'&&<button onClick={()=>void startVote(p.id)}>✓ Инициировать голосование</button>}
      <button onClick={()=>setNpaFor(npaFor===p.id?'':p.id)}>▤ Создать НПА</button>
      {teacher&&p.status==='published'&&<button className="acceptPost" onClick={()=>void acceptPoliticalPost(p.id)}>✓ Принять как решение</button>}
      {teacher&&p.status==='published'&&<button className="rejectPost" onClick={()=>void rejectPoliticalPost(p.id)}>× Отклонить</button>}
     </div>
     {npaFor===p.id&&<div className="quickNpa"><select value={npaType} onChange={e=>setNpaType(e.target.value)}><option value="fz_bill">Проект ФЗ</option><option value="fkz_bill">Проект ФКЗ</option><option value="federal_budget">Федеральный бюджет</option><option value="president_decree">Указ Президента</option><option value="government_resolution">Постановление Правительства</option><option value="gd_resolution">Постановление ГД</option><option value="sf_resolution">Постановление СФ</option><option value="municipal_act">Муниципальный акт</option></select><button className="primary" disabled={busy} onClick={()=>void quickNpa(p)}>Создать проект из публикации →</button></div>}
     {teacher&&<PostImpactEditor g={g} post={p}/>}
    </article>
   })}</section>
  </>}

  {tab==='registry'&&<section className="decisionRegistry">
   <div className="decisionRegistryHead"><div><small>ОФИЦИАЛЬНЫЙ РЕЕСТР</small><h2>Принятые решения</h2></div><span>{politicalDecisions.length}</span></div>
   {politicalDecisions.length===0?<div className="emptyState">Принятых решений пока нет.</div>:politicalDecisions.map(d=>{const p=politicalPosts.find(x=>x.id===d.post_id);return <article key={d.id}><div className="decisionRegistryNo">{d.registry_no}</div><div><small>{d.actor_label} · {d.decision_method==='vote'?'принято голосованием':'утверждено преподавателем'}</small><h3>{d.title}</h3><p>{p?.body}</p></div><time>{new Date(d.created_at).toLocaleString('ru-RU')}</time>{p&&<button onClick={()=>{setTab('feed');setSearch(p.title)}}>Открыть публикацию →</button>}</article>})}
  </section>}
 </div>;
}