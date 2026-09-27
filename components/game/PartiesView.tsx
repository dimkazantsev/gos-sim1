'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {PartyDocument} from './types';
import MediaUploadButton from './MediaUploadButton';

const DOCS:{kind:PartyDocument['doc_kind'];title:string;rule:string}[]=[
 {kind:'application',title:'Заявление о регистрации',rule:'Пункт а ст. 16 95-ФЗ'},
 {kind:'charter',title:'Устав политической партии',rule:'Пункт б ст. 16 95-ФЗ'},
 {kind:'program',title:'Программа партии',rule:'Не менее 10 положений по правилам игры'},
 {kind:'fee',title:'Документ об уплате госпошлины',rule:'Требование сценария игры; актуальную редакцию закона проверяйте отдельно'},
 {kind:'symbol',title:'Символика / эмблема',rule:'Отдельная иллюстрация по правилам игры'},
 {kind:'congress_minutes',title:'Решения учредительного съезда',rule:'Протокол / решения съезда'}
];

export default function PartiesView({g}:{g:ReturnTypeRepublic}){
 const {parties,members,profiles,partyDocuments,partyInvitations,partyMandates,me,teacher,createParty,updateParty,setPartyLeader,setPartyMandates,inviteToParty,respondPartyInvitation,cancelPartyInvitation,removePartyMember,applyPartyGhostLoss,clearPartyGhostLoss,savePartyIdentity,uploadPartyDocument,reviewPartyDocument}=g;
 const [name,setName]=useState(''),[ideology,setIdeology]=useState('');
 const [selectedId,setSelectedId]=useState('');
 const [desc,setDesc]=useState('');
 const [logo,setLogo]=useState<File|null>(null);
 const [docKind,setDocKind]=useState<PartyDocument['doc_kind']>('application');
 const [docFile,setDocFile]=useState<File|null>(null);
 const [docTitle,setDocTitle]=useState('');
 const [inviteUser,setInviteUser]=useState('');
 const [ghostLoss,setGhostLoss]=useState(25);
 const [busy,setBusy]=useState(false);

 const ranked=useMemo(()=>[...parties].sort((a,b)=>Number(b.support)-Number(a.support)||b.regions-a.regions||b.mandates-a.mandates),[parties]);
 const myParty=parties.find(p=>p.name===me?.team);
 const selected=parties.find(p=>p.id===selectedId)||myParty||ranked[0];
 const partyMembers=selected?members.filter(m=>m.kind==='student'&&m.team===selected.name):[];
 const leader=selected?members.find(m=>m.user_id===selected.leader_user_id):undefined;
 const docs=selected?partyDocuments.filter(d=>d.party_id===selected.id):[];
 const canEditIdentity=!!selected&&(teacher||selected.leader_user_id===me?.user_id);
 const isLeader=!!selected&&selected.leader_user_id===me?.user_id;
 const freeStudents=members.filter(m=>m.kind==='student'&&!m.team);
 const selectedAllocations=selected?partyMandates.filter(x=>x.party_id===selected.id):[];
 const pendingForSelected=selected?partyInvitations.filter(i=>i.party_id===selected.id&&i.status==='pending'):[];
 const myPending=partyInvitations.filter(i=>i.invited_user_id===me?.user_id&&i.status==='pending');
 const chamberMandates=parties.reduce((a,p)=>a+Number(p.mandates||0),0);

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
 async function invite(){
  if(!selected||!inviteUser)return;setBusy(true);
  const ok=await inviteToParty(selected.id,inviteUser);setBusy(false);
  if(ok)setInviteUser('');
 }

 return <div className="partyPage">
  <section className="pageHeader partyPageHeader"><div><small>ПАРТИЙНАЯ СИСТЕМА · ПРЕДСТАВИТЕЛЬСТВО</small><h1>Партии и фракции</h1><p>Состав партии, приглашения, руководство, 450 депутатских мандатов и персональный вес каждого студента связаны в одной системе.</p></div></section>

  {myPending.length>0&&<section className="partyInviteInbox">
   <div><small>ВАС ПРИГЛАСИЛИ</small><h2>Приглашения в партии</h2><p>Вступление произойдёт только после вашего подтверждения. После принятия система автоматически перераспределит депутатские мандаты между всеми студентами фракции.</p></div>
   <div className="partyInviteCards">{myPending.map(inv=>{const p=parties.find(x=>x.id===inv.party_id);const inviter=members.find(m=>m.user_id===inv.invited_by);return <article key={inv.id}><div className="invitePartyMark" style={{background:p?.color||'#6f7cff'}}>{p?.name.slice(0,2).toUpperCase()||'П'}</div><div><small>{inviter?.full_name?('Приглашает: '+inviter.full_name):'Приглашение в партию'}</small><b>{p?.name||'Партия'}</b><span>После вступления вы получите часть из {p?.mandates||0} мандатов фракции.</span></div><div><button className="primary" onClick={()=>void respondPartyInvitation(inv.id,true)}>Принять</button><button className="secondary" onClick={()=>void respondPartyInvitation(inv.id,false)}>Отклонить</button></div></article>})}</div>
  </section>}

  {teacher&&<details className="teacherDetails compactPartyCreate"><summary><div><b>Создать новую партию</b><span>Название и идеология; руководителя назначите после создания</span></div><i>+</i></summary><div className="teacherDetailsBody compactForm"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Название партии"/><input value={ideology} onChange={e=>setIdeology(e.target.value)} placeholder="Идеология"/><button className="primary" onClick={create}>Создать</button></div></details>}

  {teacher&&<section className={chamberMandates===450?'chamberBalance ok':'chamberBalance'}>
   <div><small>СОСТАВ ГОСУДАРСТВЕННОЙ ДУМЫ</small><strong>{chamberMandates}<span>/450</span></strong><p>{chamberMandates===450?'Все депутатские мандаты распределены.':chamberMandates<450?('Осталось распределить '+(450-chamberMandates)+' мандатов.'):'Распределено на '+(chamberMandates-450)+' мандатов больше состава палаты.'}</p></div>
   <i><em style={{width:Math.min(100,chamberMandates/450*100)+'%'}}/></i>
  </section>}

  <section className="partyRanking">
   <div className="partySectionTitle"><div><small>РЕЙТИНГ ПАРТИЙ</small><h2>Политический баланс</h2></div><span>мандаты и активный состав</span></div>
   <div className="partyRankingList">
    {ranked.map((p,i)=>{const count=members.filter(m=>m.kind==='student'&&m.team===p.name).length;return <button key={p.id} className={selected?.id===p.id?'rankParty active':'rankParty'} onClick={()=>{setSelectedId(p.id);setDesc(p.description||'')}}>
      <div className="rankNo">{i+1}</div>
      <div className="rankLogo">{p.logo_url?<img src={p.logo_url} alt=""/>:<span style={{background:p.color}}>{p.name.slice(0,1).toUpperCase()}</span>}</div>
      <div className="rankName"><b>{p.name}</b><small>{p.ideology||'Идеология не указана'}</small></div>
      <div className="rankMetric"><strong>{p.support}%</strong><span>поддержка</span></div>
      <div className="rankMetric"><strong>{p.mandates}</strong><span>мандатов</span></div>
      <div className="rankMetric"><strong>{count}</strong><span>студентов</span></div>
      <div className="rankMetric"><strong>{p.ghost_active?Math.max(0,p.mandates-p.ghost_loss_current):p.mandates}</strong><span>{p.ghost_active?'голосов с GV':'доступно'}</span></div>
      <div className="rankBar"><i style={{width:`${Math.min(100,Number(p.support))}%`,background:p.color}}/></div>
    </button>})}
    {!ranked.length&&<div className="emptyState">Партии ещё не созданы.</div>}
   </div>
  </section>

  {selected&&<section className="partyCabinet">
   <article className="partyIdentityCard">
    <div className="partyIdentityTop">
     <div className="partyBigLogo">{selected.logo_url?<img src={selected.logo_url} alt={'Логотип '+selected.name}/>:<span style={{background:selected.color}}>{selected.name.slice(0,2).toUpperCase()}</span>}</div>
     <div className="partyIdentityText"><small>{selected.ideology||'Идеология не указана'}</small><h2>{selected.name}</h2><p>{selected.description||'Добавьте краткое описание партии: её политическую позицию, ключевые идеи и образ в рамках деловой игры.'}</p></div>
    </div>
    <div className="partyHeadlineStats"><div><strong>{selected.support}%</strong><span>электоральная поддержка</span></div><div><strong>{selected.regions}</strong><span>контролируемых регионов</span></div><div><strong>{selected.mandates}</strong><span>мест в ГД</span></div><div><strong>{selected.ghost_active?Math.max(0,selected.mandates-selected.ghost_loss_current):selected.mandates}</strong><span>голосов на заседании</span></div><div><strong>{partyMembers.length}</strong><span>студентов</span></div></div>
    {selected.ghost_active&&<div className="partyGhostBanner"><span>⚡</span><div><small>GHOST VOTING · БЛИЖАЙШЕЕ ЗАСЕДАНИЕ</small><b>Фракция временно теряет {selected.ghost_loss_current} депутатов</b><p>Номинально {selected.mandates}, на текущем заседании доступно {Math.max(0,selected.mandates-selected.ghost_loss_current)} голосов.</p></div>{teacher&&<button onClick={()=>void clearPartyGhostLoss(selected.id)}>Завершить GV</button>}</div>}
    {canEditIdentity&&<details className="inlineEditor"><summary>Редактировать визитку партии</summary><div><textarea rows={4} value={desc||selected.description||''} onChange={e=>setDesc(e.target.value)} placeholder="Описание партии"/><MediaUploadButton files={logo?[logo]:[]} onChange={x=>setLogo(x[0]||null)} accept="image/jpeg,image/png,image/webp,image/gif" multiple={false} label="Логотип партии" hint="Загрузить изображение" variant="logo"/><button className="primary" disabled={busy} onClick={saveIdentity}>{busy?'Сохраняю…':'Сохранить'}</button></div></details>}
   </article>

   <article className="surface partyPeople">
    <div className="surfaceHead"><div><small>КОМАНДА И ПРЕДСТАВИТЕЛЬСТВО</small><h2>Кто сколько депутатов представляет</h2></div><span>{partyMembers.length} студентов</span></div>
    {leader&&<div className="leaderCard">{profiles.find(p=>p.user_id===leader.user_id)?.avatar_url?<img src={profiles.find(p=>p.user_id===leader.user_id)?.avatar_url||''} alt=""/>:<div className="personFallback">{leader.full_name.slice(0,1)}</div>}<div><small>РУКОВОДИТЕЛЬ ПАРТИИ / ФРАКЦИИ</small><h3>{leader.full_name}</h3><p>{profiles.find(p=>p.user_id===leader.user_id)?.bio||leader.role_title||'Руководитель партийной команды'}</p></div></div>}

    <div className="mandateDistribution">
     {partyMembers.length===0?<div className="emptyState">В партии пока нет студентов.</div>:partyMembers.map(m=>{const pf=profiles.find(p=>p.user_id===m.user_id);const a=selectedAllocations.find(x=>x.user_id===m.user_id);return <article className={m.user_id===selected.leader_user_id?'mandatePerson leader':'mandatePerson'} key={m.user_id}>
       <div className="mandatePersonPhoto">{pf?.avatar_url?<img src={pf.avatar_url} alt=""/>:<span>{m.full_name.slice(0,1)}</span>}</div>
       <div className="mandatePersonName"><b>{m.full_name}</b><span>{m.user_id===selected.leader_user_id?'Руководитель фракции':m.role_title||'Член фракции'}</span></div>
       <div className="mandateBlock"><strong>{a?.base_mandates||0}</strong><span>мандатов</span></div>
       <div className={a?.ghost_loss?'mandateEffective affected':'mandateEffective'}><strong>{a?.effective_mandates||0}</strong><span>голосов сейчас</span>{!!a?.ghost_loss&&<em>−{a.ghost_loss} GV</em>}</div>
       {teacher&&<button className="removePartyMember" onClick={()=>{if(confirm('Удалить студента из партии? Мандаты автоматически перераспределятся.'))void removePartyMember(selected.id,m.user_id)}}>×</button>}
      </article>})}
    </div>

    <div className="mandateMath"><b>{selected.mandates} мандатов ÷ {Math.max(1,partyMembers.length)} студентов</b><span>Система распределяет целые блоки максимально поровну; разница между участниками не превышает одного мандата.</span></div>

    {teacher&&<div className="partyTeacherControl">
     <label>Руководитель партии<select value={selected.leader_user_id||''} onChange={e=>{if(e.target.value)void setPartyLeader(selected.id,e.target.value)}}><option value="">Назначить руководителя…</option>{members.filter(m=>m.kind==='student').map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}{m.team?' · '+m.team:''}</option>)}</select></label>
     <label>Мандаты партии<input key={selected.id+'-'+selected.mandates} type="number" min="0" max="450" defaultValue={selected.mandates} onBlur={e=>void setPartyMandates(selected.id,Math.max(0,Math.min(450,Number(e.target.value)||0)))}/></label>
     <label>Ghost voting<input type="number" min="25" max="50" value={ghostLoss} onChange={e=>setGhostLoss(Math.max(25,Math.min(50,Number(e.target.value)||25)))}/></label>
     <button className="secondary" disabled={selected.mandates<=0} onClick={()=>void applyPartyGhostLoss(selected.id,ghostLoss)}>⚡ Применить GV</button>
    </div>}

    {(isLeader||teacher)&&<div className="partyInviteManager">
     <div><small>НАБОР В ПАРТИЮ</small><h3>Пригласить студента</h3><p>Доступны только студенты, которые ещё не состоят ни в одной партии.</p></div>
     <div className="partyInviteComposer"><select value={inviteUser} onChange={e=>setInviteUser(e.target.value)}><option value="">Выберите студента…</option>{freeStudents.map(s=><option key={s.user_id} value={s.user_id}>{s.full_name} · {s.group_name||'без группы'}</option>)}</select><button className="primary" disabled={!inviteUser||busy} onClick={invite}>Отправить приглашение</button></div>
     {pendingForSelected.length>0&&<div className="pendingInvites">{pendingForSelected.map(inv=>{const s=members.find(m=>m.user_id===inv.invited_user_id);return <div key={inv.id}><span>○</span><b>{s?.full_name||'Студент'}</b><small>Ожидается ответ</small><button onClick={()=>void cancelPartyInvitation(inv.id)}>Отменить</button></div>})}</div>}
    </div>}
   </article>
  </section>}

  {selected&&<section className="partyDocumentsSection">
   <div className="partySectionTitle"><div><small>УЧРЕДИТЕЛЬНЫЙ ПАКЕТ</small><h2>Документы партии</h2></div><span>{docs.length} загружено</span></div>
   <div className="requiredDocs">
    {DOCS.map(req=>{const d=docs.find(x=>x.doc_kind===req.kind);return <article className={d?'requiredDoc complete':'requiredDoc'} key={req.kind}><div className="docState">{d?'✓':'○'}</div><div><b>{req.title}</b><span>{req.rule}</span>{d&&<a href={d.url||'#'} target="_blank" rel="noreferrer">{d.file_name}</a>}</div>{d&&<em className={`docReview ${d.status}`}>{d.status==='accepted'?'Принято':d.status==='revision'?'На доработку':'Загружено'}</em>}</article>})}
   </div>
   {canEditIdentity&&<div className="partyUpload surface"><div><small>ЗАГРУЗИТЬ ДОКУМЕНТ</small><h3>Добавить в партийное дело</h3></div><select value={docKind} onChange={e=>setDocKind(e.target.value as PartyDocument['doc_kind'])}>{DOCS.map(x=><option key={x.kind} value={x.kind}>{x.title}</option>)}</select><input value={docTitle} onChange={e=>setDocTitle(e.target.value)} placeholder="Название документа"/><label className="filePicker">Выбрать файл<input type="file" accept=".pdf,.doc,.docx,.txt,image/jpeg,image/png,image/webp" onChange={e=>setDocFile(e.target.files?.[0]||null)}/></label><button className="primary" disabled={!docFile||busy} onClick={uploadDoc}>{busy?'Загрузка…':'Загрузить'}</button></div>}
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