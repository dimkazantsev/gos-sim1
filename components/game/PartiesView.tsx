'use client';
import JusticeDocuments from './JusticeDocuments';
import PartyChairElection from './PartyChairElection';
import {isStageWorkOpen} from './stageWorkStatus';
import {useMemo,useState,type ComponentType} from 'react';
import {IconAction} from '../ui/IconAction';
import {ChevronDown,FileText,PencilLine,Plus,Trash2,UserPlus,UsersRound} from 'lucide-react';
import StyledSelect from '../ui/StyledSelect';
import ProfileAvatar from './ProfileAvatar';
import PartyLogoEditor from './PartyLogoEditor';
import type {PartyDocument} from './types';
import {partyDocumentLatest,partyDocVersion,partyLatestPublicDocuments,requiredPartyKinds,partyDocumentLabel} from './partyDocumentWorkflow';
import type {ReturnTypeRepublic} from './viewTypes';
const DOCS:{kind:PartyDocument['doc_kind'];title:string;template:string}[]=[{kind:'application',title:'Заявление о регистрации',template:'party_application'},{kind:'charter',title:'Устав',template:'party_charter'},{kind:'program',title:'Программа',template:'party_program'},{kind:'fee',title:'Сведения об уплате госпошлины',template:'party_fee'},{kind:'symbol',title:'Символика',template:'party_symbol'},{kind:'congress_minutes',title:'Учредительный съезд',template:'party_congress'}];
const statusLabel:Record<string,string>={registered:'Зарегистрирована',submitted:'На регистрации',draft:'Пакет готовится',revision:'На доработке',rejected:'Регистрация отклонена'};
function PartyDisclosureSummary({icon:Icon,title,meta}:{icon:ComponentType<{size?:number}>;title:string;meta?:string}){
 return <summary className="civicPartyDisclosureSummary"><span className="civicPartyDisclosureIcon" aria-hidden="true"><Icon size={20}/></span><span className="civicPartyDisclosureText"><b>{title}</b>{meta&&<small>{meta}</small>}</span><span className="civicPartyDisclosureChevron" aria-hidden="true"><ChevronDown size={19}/></span></summary>;
}
export default function PartiesView({g}:{g:ReturnTypeRepublic}){
 const {parties,members,profiles,partyDocuments,partyInvitations,partyMandates,me,teacher}=g;
 const [selectedId,setSelectedId]=useState(''),[query,setQuery]=useState(''),[description,setDescription]=useState(''),[busy,setBusy]=useState(false),[docKind,setDocKind]=useState<PartyDocument['doc_kind']>('application'),[docFile,setDocFile]=useState<File|null>(null),[docTitle,setDocTitle]=useState(''),[inviteUser,setInviteUser]=useState(''),[name,setName]=useState(''),[ideology,setIdeology]=useState('');
 const [deletingPartyId,setDeletingPartyId]=useState('');
 const [documentNotice,setDocumentNotice]=useState<{partyId:string;kind:'success'|'error';message:string}|null>(null);
 const [inviteFeedback,setInviteFeedback]=useState<{partyId:string;kind:'success'|'error';message:string}|null>(null);
 const stageOne=g.stages.find(s=>s.stage_no===1);
 const partyFormationOpen=isStageWorkOpen(g.game,stageOne);
 const canCreate=partyFormationOpen&&(!!teacher||(me?.kind==='student'&&!me.team&&!me.roster_archived_at));
 const ranked=useMemo(()=>[...parties].filter(p=>!query.trim()||[p.name,p.ideology,p.description].join(' ').toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.support-a.support),[parties,query]);
 const selected=parties.find(p=>p.id===selectedId)||parties.find(p=>p.name===me?.team)||ranked[0],own=!!selected&&(teacher||selected.name===me?.team),canEditDescription=partyFormationOpen&&!!selected&&(teacher||selected.leader_user_id===me?.user_id),canUploadLogo=partyFormationOpen&&!!selected&&(teacher||me?.kind==='student'&&!me.roster_archived_at&&selected.name===me.team),staff=members.filter(m=>m.kind==='student'&&!m.roster_archived_at&&m.team===selected?.name),leader=members.find(m=>m.user_id===selected?.leader_user_id),docs=partyDocuments.filter(d=>d.party_id===selected?.id),latestByKind=partyDocumentLatest(docs),certified=!!selected&&selected.registration_status==='registered'&&g.formalDocuments.some(d=>d.doc_type==='party_certificate'&&d.metadata?.party_id===selected.id),publicDocs=partyLatestPublicDocuments(docs,certified),free=members.filter(m=>m.kind==='student'&&!m.roster_archived_at&&!m.team),pending=partyInvitations.filter(i=>i.party_id===selected?.id&&i.status==='pending'),inbox=partyInvitations.filter(i=>i.invited_user_id===me?.user_id&&i.status==='pending');
 const canInvite=partyFormationOpen&&!!selected&&!!me&&!me.roster_archived_at&&(teacher||me.kind==='student'&&me.team===selected.name);
 const inviteClosed=!!selected?.leader_user_id;
 const workflowCount=partyInvitations.filter(i=>i.game_id===g.game?.id&&i.status==='pending'&&i.invited_user_id===me?.user_id).length;
 async function saveDescription(){if(!selected)return;setBusy(true);try{await g.savePartyIdentity(selected.id,description||selected.description||'')}finally{setBusy(false)}}
 async function saveLogo(file:File):Promise<boolean>{if(!selected)return false;setBusy(true);try{return await g.savePartyIdentity(selected.id,undefined,file)}finally{setBusy(false)}}
 async function upload(){
  if(!selected||!docFile||busy)return;
  const partyId=selected.id;
  setBusy(true);setDocumentNotice(null);
  try{
   const ok=await g.uploadPartyDocument(partyId,docKind,docTitle.trim()||DOCS.find(d=>d.kind===docKind)?.title||docFile.name,docFile);
   if(ok){
    setDocFile(null);setDocTitle('');
    setDocumentNotice({partyId,kind:'success',message:'Новая версия документа загружена. Преподаватель рассмотрит последнюю редакцию; предыдущие попытки сохранены в истории. До регистрации документы непубличны.'});
   }else setDocumentNotice({partyId,kind:'error',message:'Документ не зарегистрирован. Посмотрите сообщение об ошибке и повторите попытку после устранения причины.'});
  }catch(e){
   g.setError(e);
   setDocumentNotice({partyId,kind:'error',message:'Не удалось завершить загрузку документа.'});
  }finally{setBusy(false)}
 }
 async function uploadVersion(kind:PartyDocument['doc_kind'],file:File){
  if(!selected||busy||selected.registration_status==='registered')return;
  const partyId=selected.id,previous=latestByKind.get(kind);
  setBusy(true);setDocumentNotice(null);
  try{
   const ok=await g.uploadPartyDocument(partyId,kind,previous?.title||partyDocumentLabel[kind]||file.name,file);
   setDocumentNotice({partyId,kind:ok?'success':'error',message:ok?
    'Новая редакция «'+(partyDocumentLabel[kind]||kind)+'» загружена. Версия В'+(previous?partyDocVersion(previous)+1:1)+' ожидает проверки.':
    'Не удалось зарегистрировать новую версию. Проверьте сообщение об ошибке.'});
  }catch(e){g.setError(e);setDocumentNotice({partyId,kind:'error',message:'Ошибка повторной загрузки документа.'})}
  finally{setBusy(false)}
 }
 async function sendPartyInvite(){
  if(!selected||!inviteUser||busy||inviteClosed)return;
  const partyId=selected.id;
  const recipientName=free.find(m=>m.user_id===inviteUser)?.full_name||'участнику';
  setBusy(true);setInviteFeedback(null);
  try{
   const ok=await g.inviteToParty(partyId,inviteUser,message=>setInviteFeedback({partyId,kind:'error',message}));
   if(ok){
    setInviteUser('');
    setInviteFeedback({partyId,kind:'success',message:'Приглашение отправлено: '+recipientName+'. Ожидается ответ участника.'});
   }
  }catch(e){
   const message=e instanceof Error?e.message:'Не удалось отправить приглашение. Повторите попытку.';
   setInviteFeedback({partyId,kind:'error',message});g.setError(message);
  }finally{setBusy(false)}
 }
 function canDeleteParty(p:typeof parties[number]){return !!me&&(teacher||(p.created_by===me.user_id&&p.registration_status!=='registered'))}
 async function removeParty(p:typeof parties[number]){
  if(!canDeleteParty(p)||deletingPartyId)return;
  const warning=p.registration_status==='registered'
   ?'Удалить зарегистрированную партию «'+p.name+'»? Это действие доступно преподавателю и удалит связанные партийные данные.'
   :'Удалить партию «'+p.name+'»? Документы, приглашения, мандаты, соглашения и связанные партийные данные будут удалены.';
  if(!confirm(warning))return;
  setDeletingPartyId(p.id);
  const ok=await g.deleteParty(p.id);
  if(ok&&selectedId===p.id)setSelectedId('');
  setDeletingPartyId('');
 }

 return <div className="partyPage civicParties"><header className="pageHeader"><div><h1>Партии и фракции</h1><p>Публичные программы, партийные документы, руководство и состав.</p></div><span className={'gosPartyStageBadge '+(partyFormationOpen?'isActive':'isLocked')}>{partyFormationOpen?'Этап 01 открыт':'Этап 01 не открыт'}</span></header>
  {!partyFormationOpen&&<div className="gosPartyStageWarning" role="status">Работа с партиями откроется после запуска первого этапа преподавателем. Пока доступны только сведения о партиях и результатах.</div>}
  {inbox.length>0&&<section className="civicPartyInbox"><h2>Приглашения в партии <span className="gosPartyCount">{workflowCount}</span></h2>{inbox.map(i=><article key={i.id}><b>{parties.find(p=>p.id===i.party_id)?.name||'Партия'}</b><button className="primary" disabled={!partyFormationOpen||me?.kind!=='student'||!!me.roster_archived_at} onClick={()=>void g.respondPartyInvitation(i.id,true)}>Принять</button><button className="secondary" disabled={!partyFormationOpen||me?.kind!=='student'} onClick={()=>void g.respondPartyInvitation(i.id,false)}>Отклонить</button></article>)}</section>}
  <input className="civicPartySearch" aria-label="Поиск партий" placeholder="Название, идеология или программа" value={query} onChange={e=>setQuery(e.target.value)}/>
  <section className="civicPartyTiles" aria-label="Публичные партии">{ranked.map(p=><article className={selected?.id===p.id?'civicPartyTile active':'civicPartyTile'} key={p.id}><button type="button" className="civicPartyTileSelect" onClick={()=>{setSelectedId(p.id);setDescription(p.description||'');setInviteUser('');setInviteFeedback(null)}}><span className="civicPartyLogo" style={{background:p.color}}>{p.logo_url?<img src={p.logo_url} alt=""/>:p.name.slice(0,1)}</span><span className="civicPartyTileCopy"><b>{p.name}</b><small>{p.ideology||'Идеология не указана'}</small><small>{statusLabel[p.registration_status]}</small></span><span className="civicPartyTileStats"><b>{p.support}%</b> поддержка · <b>{p.mandates}</b> мандатов</span></button>{canDeleteParty(p)&&<button type="button" className="civicPartyDelete" aria-label={'Удалить партию «'+p.name+'»'} title={teacher?'Удалить партию':'Удалить свою партию до регистрации'} disabled={deletingPartyId===p.id} onClick={()=>void removeParty(p)}>{deletingPartyId===p.id?<span aria-hidden="true">…</span>:<Trash2 size={17}/>}</button>}</article>)}{!ranked.length&&<p>Партии не найдены.</p>}</section>
  {selected&&<section className="civicPartyPublic"><header><span className="civicPartyLogo" style={{background:selected.color}}>{selected.logo_url?<img src={selected.logo_url} alt={'Эмблема: '+selected.name}/>:selected.name.slice(0,1)}</span><div><h2>{selected.name}</h2><p>{selected.ideology||'Идеология не указана'}</p></div><span>{statusLabel[selected.registration_status]}</span></header>
  {own&&[...latestByKind.values()].some(d=>d.reviewed_at||d.status==='revision'||d.status==='accepted')&&
   <section className="partyDossierUpdates" role="status" aria-label="Решения Минюста по документам партии">
    <b>Извещения Минюста · Регистрация партии</b>
    <p>Заключения по последним версиям документов. Все участники партии видят одинаковые решения.</p>
    <ul>{[...latestByKind.values()].filter(d=>d.reviewed_at||d.status==='revision'||d.status==='accepted')
     .sort((a,b)=>(b.reviewed_at||b.created_at).localeCompare(a.reviewed_at||a.created_at)).map(d=>
     <li key={d.id}><b>{partyDocumentLabel[d.doc_kind]||d.title} · В{partyDocVersion(d)}</b>
      <span>{d.status==='accepted'?'Принято Минюстом':d.status==='revision'?'Возвращено на доработку':'Рассмотрение'}</span>
      {d.note&&<p>Причина и рекомендации: {d.note}</p>}
     </li>)}</ul>
   </section>}
   <p className="civicPartyDescription">{selected.description||'Публичное описание пока не опубликовано.'}</p><div className="civicPartyFacts"><span><b>{selected.support}%</b> поддержка</span><span><b>{selected.mandates}</b> мандатов</span><span><b>{selected.regions}</b> регионов</span><span><b>{staff.length}</b> участников</span></div>
   <div className="civicPartyLeader"><span className="eventVoter"><ProfileAvatar name={leader?.full_name||'Не назначен'} src={profiles.find(p=>p.user_id===leader?.user_id)?.avatar_url}/></span><div><small>Председатель партии</small><b>{leader?.full_name||'Не назначен'}</b></div></div>
   <PartyChairElection g={g} party={selected}/><section className="civicPublicDocs"><h3>Публичные документы</h3>{publicDocs.length?publicDocs.map(d=><a key={d.id} href={d.url||undefined} target="_blank" rel="noreferrer"><div><b>{DOCS.find(x=>x.kind===d.doc_kind)?.title||d.title}</b><span>{d.title}</span><small>{d.file_name}</small></div><span>Открыть</span></a>):<p>Документы станут публичными только после принятия всех обязательных редакций Минюстом, регистрации партии и выдачи свидетельства.</p>}</section>
   {canInvite&&<details className="civicPartyEditor" data-party-invite-panel><PartyDisclosureSummary icon={UserPlus} title="Пригласить участника" meta={inviteClosed?'Приём закрыт. Председатель избран.':'Ожидают ответа: '+pending.length+' · приглашать можно только студентов'}/>
    {inviteClosed&&<p className="civicPartyInviteFeedback" role="status">Приём приглашений завершён: председатель партии уже избран. Новые приглашения запрещены правилами первого этапа.</p>}
    <StyledSelect label="Студент" value={inviteUser} onChange={value=>{setInviteUser(value);setInviteFeedback(null)}} disabled={busy||inviteClosed} options={[{value:'',label:'Выберите участника'},...free.map(m=>({value:m.user_id,label:m.full_name}))]}/>
    <button type="button" className="primary" disabled={!inviteUser||busy||inviteClosed} onClick={()=>void sendPartyInvite()}>{busy?'Отправка…':'Пригласить'}</button>
    {!inviteClosed&&inviteFeedback?.partyId===selected.id&&<p className={'civicPartyInviteFeedback '+(inviteFeedback.kind==='error'?'isError':'isSuccess')} role={inviteFeedback.kind==='error'?'alert':'status'}>{inviteFeedback.message}</p>}
    {pending.map(i=><div className="civicPendingInvite" key={i.id}><span>{g.names[i.invited_user_id]}</span><IconAction variant="remove" label="Отменить приглашение" onClick={()=>void g.cancelPartyInvitation(i.id)}/></div>)}
   </details>}
   <details className="civicPartyRoster"><PartyDisclosureSummary icon={UsersRound} title="Состав партии" meta={staff.length+' участников'}/><ul>{staff.map(m=><li key={m.user_id}><span className="eventVoter"><ProfileAvatar name={m.full_name} src={profiles.find(p=>p.user_id===m.user_id)?.avatar_url}/></span><div><b>{m.full_name}</b><small>{m.user_id===selected.leader_user_id?'Председатель партии «'+selected.name+'»':m.role_title||'Участник'}</small></div><span>{partyMandates.find(a=>a.user_id===m.user_id)?.base_mandates||0} мандатов</span></li>)}</ul></details>
   {(canEditDescription||canUploadLogo)&&<details className="civicPartyEditor"><PartyDisclosureSummary icon={PencilLine} title="Оформление партии" meta="Эмблема и публичное описание"/>{canEditDescription&&<><label>Описание<textarea rows={4} value={description||selected.description||''} onChange={e=>setDescription(e.target.value)}/></label><button className="secondary" disabled={busy} onClick={()=>void saveDescription()}>Сохранить описание</button></>}{canUploadLogo&&<PartyLogoEditor key={selected.id} partyName={selected.name} disabled={busy} onSave={saveLogo}/>}</details>}
   <fieldset className="gosPartyStageFieldset" disabled={!partyFormationOpen}><JusticeDocuments g={g} partyId={selected.id}/></fieldset>
   {own&&<details className="civicPartyPackage"><PartyDisclosureSummary icon={FileText} title="Документы и регистрация партии" meta={docs.length+' файлов'}/><p role="status">{selected.registration_note||'Подготовьте документы. Преподаватель рассмотрит каждую редакцию; замечания появятся здесь у всех членов партии.'}</p><div className="civicPartyFiles partyDossierAttempts" aria-label="История рассмотрения документов партии">
    <h4>Регистрационный пакет · версии и решения Минюста</h4>
    <p>Каждая новая загрузка сохраняется как В1, В2, В3 и далее без ограничения попыток. До регистрации документы доступны только партии и Минюсту.</p>
    {requiredPartyKinds.map(kind=>{
     const current=latestByKind.get(kind);
     const history=docs.filter(d=>d.doc_kind===kind).sort((a,b)=>partyDocVersion(b)-partyDocVersion(a));
     const status=current?.status==='accepted'?'Принята':current?.status==='revision'?'На доработке':current?'Ожидает проверки':'Не загружена';
     return <section key={kind} className="partyDossierAttempt" data-party-doc-kind={kind}>
      <header><b>{partyDocumentLabel[kind]}</b><span className={current?.status==='revision'?'partyDossierRevision':''}>{current?'В'+partyDocVersion(current)+' · '+status:status}</span></header>
      {current?.note&&<p className="partyDossierFeedback" role="status"><b>Заключение Минюста по В{partyDocVersion(current)}:</b> {current.note}</p>}
      {!!current?.reviewed_at&&<small>Проверено: {new Date(current.reviewed_at).toLocaleString('ru-RU')}</small>}
      {current?.status==='revision'&&<p className="partyDossierAction">Устраните замечания и загрузите новую редакцию. Предыдущая версия и решение останутся в истории.</p>}
      {partyFormationOpen&&!!selected.leader_user_id&&selected.registration_status!=='registered'&&
       <label className="secondary partyDossierReload">Загрузить {current?'В'+(partyDocVersion(current)+1):'В1'}
        <input aria-label={'Перезагрузить '+partyDocumentLabel[kind]} type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp" disabled={busy}
         onChange={e=>{const file=e.target.files?.[0];if(file)void uploadVersion(kind,file);e.target.value=''}}/>
       </label>}
      {history.length>0&&<details className="partyDossierHistory"><summary>История версий ({history.length})</summary>
       {history.map(d=><article key={d.id}><a href={d.url||undefined} target="_blank" rel="noreferrer">В{partyDocVersion(d)} · {d.file_name}</a>
        <small>{new Date(d.created_at).toLocaleString('ru-RU')} · {d.status==='accepted'?'Принята':d.status==='revision'?'Доработка':'На рассмотрении'}</small>
        {d.note&&<p>Замечания: {d.note}</p>}
       </article>)}</details>}
     </section>;
    })}
    {documentNotice?.partyId===selected.id&&<p role={documentNotice.kind==='error'?'alert':'status'} className={'civicPartyInviteFeedback '+(documentNotice.kind==='error'?'isError':'isSuccess')}>{documentNotice.message}</p>}
   </div>{!!selected.leader_user_id&&partyFormationOpen&&selected.registration_status!=='registered'&&<div className="civicPartyUpload" data-party-document-upload>
     <div className="civicPartyUploadMain">
      <StyledSelect label="Вид документа" value={docKind} onChange={v=>setDocKind(v as PartyDocument['doc_kind'])} options={DOCS.map(d=>({value:d.kind,label:d.title}))}/>
      <label className="civicPartyUploadField"><span>Название</span><input value={docTitle} onChange={e=>setDocTitle(e.target.value)} placeholder="Введите название документа"/></label>
      <label className="civicPartyUploadField civicPartyUploadFile"><span>Файл</span><input type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp" onChange={e=>setDocFile(e.target.files?.[0]||null)}/></label>
      {documentNotice?.partyId===selected.id&&<p role={documentNotice.kind==='error'?'alert':'status'} className={'civicPartyInviteFeedback '+(documentNotice.kind==='error'?'isError':'isSuccess')}>{documentNotice.message}</p>}
      <div className="civicPartyUploadActions">
       <button type="button" className="primary" disabled={busy||!docFile} onClick={()=>void upload()}>{busy?'Загрузка…':'Загрузить документ'}</button>
       <button type="button" className="secondary" disabled={busy||!(teacher||me?.user_id===selected.leader_user_id)||!requiredPartyKinds.every(kind=>latestByKind.has(kind)&&latestByKind.get(kind)?.status!=='revision')} onClick={()=>void g.submitPartyRegistration(selected.id)}>Направить на регистрацию</button>
      </div>
     </div>
     <aside className="partyLegalRequirements" aria-label="Нормативные требования к документу">
      <h4>Нормативные требования</h4>
      <a className="secondary" href="https://pravo.gov.ru/proxy/ips/?docbody=&nd=102071991" target="_blank" rel="noreferrer">Требования к документу · Закон № 95-ФЗ</a>
      <a href="https://minjust.gov.ru/ru/documents/7719/" target="_blank" rel="noreferrer">Официальные формы Минюста · Приказ № 333</a>
      <small>{docKind==='charter'?'Статья 21: содержание устава.':docKind==='program'?'Статья 22: программа партии.':docKind==='symbol'?'Статья 7: символика партии.':docKind==='fee'?'Статья 16: документ об уплате госпошлины. Размер и льготы — статья 333.33 НК РФ.':docKind==='congress_minutes'?'Статьи 11 и 16: учредительный съезд и протокол.':'Статья 16: заявление и регистрационный пакет. Формы утверждены приказом Минюста от 12.11.2024 № 333.'}</small>
     </aside>
    </div>}</details>}

  </section>}
  {canCreate&&<details open className="civicPartyEditor"><PartyDisclosureSummary icon={Plus} title="Создать партию" meta="Новая политическая организация"/><label>Название<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Идеология<input value={ideology} onChange={e=>setIdeology(e.target.value)}/></label><button className="primary" disabled={busy||!name.trim()||!ideology.trim()} onClick={async()=>{if(await g.createParty(name,ideology)){setName('');setIdeology('')}}}>Создать</button></details>}
 </div>;
}
