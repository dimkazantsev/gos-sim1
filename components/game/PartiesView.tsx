'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {PartyDocument} from './types';

const DOCS:{kind:PartyDocument['doc_kind'];title:string;rule:string}[]=[
 {kind:'application',title:'Заявление о регистрации',rule:'Пункт а ст. 16 95-ФЗ'},
 {kind:'charter',title:'Устав политической партии',rule:'Пункт б ст. 16 95-ФЗ'},
 {kind:'program',title:'Программа партии',rule:'Не менее 10 положений по правилам игры'},
 {kind:'fee',title:'Документ об уплате госпошлины',rule:'Требование сценария игры; в актуальной редакции закона проверяйте отдельно'},
 {kind:'symbol',title:'Символика / эмблема',rule:'Отдельная иллюстрация по правилам игры'},
 {kind:'congress_minutes',title:'Решения учредительного съезда',rule:'Протокол / решения съезда'}
];

export default function PartiesView({g}:{g:ReturnTypeRepublic}){
 const {parties,members,profiles,partyDocuments,me,teacher,createParty,updateParty,assignParty,savePartyIdentity,uploadPartyDocument,reviewPartyDocument}=g;
 const [name,setName]=useState(''),[ideology,setIdeology]=useState('');
 const [selectedId,setSelectedId]=useState('');
 const [desc,setDesc]=useState('');
 const [logo,setLogo]=useState<File|null>(null);
 const [docKind,setDocKind]=useState<PartyDocument['doc_kind']>('application');
 const [docFile,setDocFile]=useState<File|null>(null);
 const [docTitle,setDocTitle]=useState('');
 const [busy,setBusy]=useState(false);

 const ranked=useMemo(()=>[...parties].sort((a,b)=>Number(b.support)-Number(a.support)||b.regions-a.regions||b.mandates-a.mandates),[parties]);
 const myParty=parties.find(p=>p.name===me?.team);
 const selected=parties.find(p=>p.id===selectedId)||myParty||ranked[0];
 const partyMembers=selected?members.filter(m=>m.team===selected.name):[];
 const leader=selected?members.find(m=>m.user_id===selected.leader_user_id):undefined;
 const docs=selected?partyDocuments.filter(d=>d.party_id===selected.id):[];
 const canEdit=!!selected&&(teacher||me?.team===selected.name);

 async function create(){if(await createParty(name,ideology)){setName('');setIdeology('')}}
 async function saveIdentity(){
  if(!selected)return;setBusy(true);
  await savePartyIdentity(selected.id,desc||selected.description||'',logo||undefined);
  setBusy(false);setLogo(null);
 }
 async function uploadDoc(){
  if(!selected||!docFile)return;setBusy(true);
  const ok=await uploadPartyDocument(selected.id,docKind,docTitle||DOCS.find(x=>x.kind===docKind)?.title||docFile.name,docFile);
  setBusy(false);if(ok){setDocFile(null);setDocTitle('')}
 }

 return <div className="partyPage">
  <section className="pageHeader partyPageHeader"><div><small>ПАРТИЙНАЯ СИСТЕМА</small><h1>Партии и фракции</h1><p>Рейтинг, поддержка, территория влияния, руководство, состав, документы и нормативная база — в одном кабинете.</p></div></section>

  {teacher&&<details className="teacherDetails compactPartyCreate"><summary><div><b>Создать новую партию</b><span>Название, идеология и первоначальный состав</span></div><i>+</i></summary><div className="teacherDetailsBody compactForm"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Название партии"/><input value={ideology} onChange={e=>setIdeology(e.target.value)} placeholder="Идеология"/><button className="primary" onClick={create}>Создать</button></div></details>}

  <section className="partyRanking">
   <div className="partySectionTitle"><div><small>РЕЙТИНГ ПАРТИЙ</small><h2>Политический баланс</h2></div><span>по текущей поддержке</span></div>
   <div className="partyRankingList">
    {ranked.map((p,i)=><button key={p.id} className={selected?.id===p.id?'rankParty active':'rankParty'} onClick={()=>{setSelectedId(p.id);setDesc(p.description||'')}}>
      <div className="rankNo">{i+1}</div>
      <div className="rankLogo">{p.logo_url?<img src={p.logo_url} alt=""/>:<span style={{background:p.color}}>{p.name.slice(0,1).toUpperCase()}</span>}</div>
      <div className="rankName"><b>{p.name}</b><small>{p.ideology||'Идеология не указана'}</small></div>
      <div className="rankMetric"><strong>{p.support}%</strong><span>поддержка</span></div>
      <div className="rankMetric"><strong>{p.regions}</strong><span>регионов</span></div>
      <div className="rankMetric"><strong>{p.mandates}</strong><span>мандатов</span></div>
      <div className="rankBar"><i style={{width:`${Math.min(100,Number(p.support))}%`,background:p.color}}/></div>
    </button>)}
    {!ranked.length&&<div className="emptyState">Партии ещё не созданы.</div>}
   </div>
  </section>

  {selected&&<section className="partyCabinet">
   <article className="partyIdentityCard">
    <div className="partyIdentityTop">
     <div className="partyBigLogo">{selected.logo_url?<img src={selected.logo_url} alt={'Логотип '+selected.name}/>:<span style={{background:selected.color}}>{selected.name.slice(0,2).toUpperCase()}</span>}</div>
     <div className="partyIdentityText"><small>{selected.ideology||'Идеология не указана'}</small><h2>{selected.name}</h2><p>{selected.description||'Добавьте краткое описание партии: её политическую позицию, ключевые идеи и образ в рамках деловой игры.'}</p></div>
    </div>
    <div className="partyHeadlineStats"><div><strong>{selected.support}%</strong><span>электоральная поддержка</span></div><div><strong>{selected.regions}</strong><span>контролируемых регионов</span></div><div><strong>{selected.mandates}</strong><span>мандатов в ГД</span></div><div><strong>{partyMembers.length}</strong><span>участников</span></div></div>
    {canEdit&&<details className="inlineEditor"><summary>Редактировать визитку партии</summary><div><textarea rows={4} value={desc||selected.description||''} onChange={e=>setDesc(e.target.value)} placeholder="Описание партии"/><label className="filePicker">Загрузить логотип<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setLogo(e.target.files?.[0]||null)}/></label>{logo&&<small>{logo.name}</small>}<button className="primary" disabled={busy} onClick={saveIdentity}>{busy?'Сохраняю…':'Сохранить'}</button></div></details>}
   </article>

   <article className="surface partyPeople">
    <div className="surfaceHead"><div><small>КОМАНДА</small><h2>Руководство и участники</h2></div><span>{partyMembers.length}</span></div>
    {leader&&<div className="leaderCard">{profiles.find(p=>p.user_id===leader.user_id)?.avatar_url?<img src={profiles.find(p=>p.user_id===leader.user_id)?.avatar_url||''} alt=""/>:<div className="personFallback">{leader.full_name.slice(0,1)}</div>}<div><small>ПРЕДСЕДАТЕЛЬ ПАРТИИ</small><h3>{leader.full_name}</h3><p>{profiles.find(p=>p.user_id===leader.user_id)?.bio||leader.role_title||'Руководитель партийной команды'}</p></div></div>}
    <div className="peopleGrid">{partyMembers.filter(m=>m.user_id!==leader?.user_id).map(m=>{const pf=profiles.find(p=>p.user_id===m.user_id);return <div className="personCard" key={m.user_id}>{pf?.avatar_url?<img src={pf.avatar_url} alt=""/>:<div className="personFallback">{m.full_name.slice(0,1)}</div>}<b>{m.full_name}</b><span>{m.role_title||'Участник партии'}</span>{pf?.bio&&<p>{pf.bio}</p>}</div>})}</div>
    {teacher&&<details className="inlineEditor"><summary>Распределить участников и назначить председателя</summary><div className="memberRows">{members.filter(m=>m.kind!=='teacher').map(m=><div key={m.user_id}><b>{m.full_name}</b><select value={m.team||''} onChange={e=>assignParty(m.user_id,e.target.value)}><option value="">Без партии</option>{parties.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}</select></div>)}</div><label className="partyLeader">Председатель<select value={selected.leader_user_id||''} onChange={e=>updateParty(selected.id,{leader_user_id:e.target.value||null})}><option value="">Не назначен</option>{partyMembers.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label></details>}
   </article>
  </section>}

  {selected&&<section className="partyDocumentsSection">
   <div className="partySectionTitle"><div><small>УЧРЕДИТЕЛЬНЫЙ ПАКЕТ</small><h2>Документы партии</h2></div><span>{docs.length} загружено</span></div>
   <div className="requiredDocs">
    {DOCS.map(req=>{const d=docs.find(x=>x.doc_kind===req.kind);return <article className={d?'requiredDoc complete':'requiredDoc'} key={req.kind}><div className="docState">{d?'✓':'○'}</div><div><b>{req.title}</b><span>{req.rule}</span>{d&&<a href={d.url||'#'} target="_blank" rel="noreferrer">{d.file_name}</a>}</div>{d&&<em className={`docReview ${d.status}`}>{d.status==='accepted'?'Принято':d.status==='revision'?'На доработку':'Загружено'}</em>}</article>})}
   </div>
   {canEdit&&<div className="partyUpload surface"><div><small>ЗАГРУЗИТЬ ДОКУМЕНТ</small><h3>Добавить в партийное дело</h3></div><select value={docKind} onChange={e=>setDocKind(e.target.value as PartyDocument['doc_kind'])}>{DOCS.map(x=><option key={x.kind} value={x.kind}>{x.title}</option>)}</select><input value={docTitle} onChange={e=>setDocTitle(e.target.value)} placeholder="Название документа"/><label className="filePicker">Выбрать файл<input type="file" accept=".pdf,.doc,.docx,.txt,image/jpeg,image/png,image/webp" onChange={e=>setDocFile(e.target.files?.[0]||null)}/></label><button className="primary" disabled={!docFile||busy} onClick={uploadDoc}>{busy?'Загрузка…':'Загрузить'}</button></div>}
   {teacher&&docs.length>0&&<div className="surface partyReview"><div className="surfaceHead"><div><small>МИНЮСТ РФ · ИГРОВАЯ РОЛЬ</small><h2>Рассмотрение документов</h2></div></div>{docs.map(d=><div className="reviewRow" key={d.id}><div><b>{d.title}</b><span>{d.file_name}</span></div><a href={d.url||'#'} target="_blank" rel="noreferrer">Открыть</a><button onClick={()=>reviewPartyDocument(d.id,'accepted')}>✓ Принять</button><button onClick={()=>reviewPartyDocument(d.id,'revision')}>↺ На доработку</button></div>)}</div>}
  </section>}

  <section className="lawLibrary">
   <div className="partySectionTitle"><div><small>НОРМАТИВНАЯ БАЗА</small><h2>Федеральное законодательство</h2></div><span>закреплено в разделе</span></div>
   <div className="lawCards">
    <a href="https://www.consultant.ru/document/cons_doc_LAW_32459/" target="_blank" rel="noreferrer"><span>95-ФЗ</span><div><b>О политических партиях</b><p>Основной федеральный закон: создание, деятельность, устав, программа, символика, регистрация.</p></div><i>↗</i></a>
    <a href="https://www.consultant.ru/document/cons_doc_LAW_32459/cb1de735e98c141e8261445e5deb739bcd629797/" target="_blank" rel="noreferrer"><span>ст. 16</span><div><b>Документы для государственной регистрации</b><p>Актуальный перечень документов, представляемых для регистрации партии.</p></div><i>↗</i></a>
    <a href="https://www.consultant.ru/document/cons_doc_LAW_37119/" target="_blank" rel="noreferrer"><span>67-ФЗ</span><div><b>Об основных гарантиях избирательных прав</b><p>Базовые правила участия в выборах и деятельности избирательных объединений.</p></div><i>↗</i></a>
    <a href="https://ips.pravo.gov.ru/" target="_blank" rel="noreferrer"><span>Официально</span><div><b>Официальное опубликование правовых актов</b><p>Проверка актуальной редакции федерального законодательства.</p></div><i>↗</i></a>
   </div>
   <div className="lawNote"><b>Важно для игры.</b> В правилах первого этапа сохранено требование подготовить позиции а, б, в и д ст. 16 95-ФЗ. Интерфейс показывает этот пакет как часть сценария игры, а рядом отдельно даёт ссылку на актуальную редакцию закона.</div>
  </section>
 </div>;
}