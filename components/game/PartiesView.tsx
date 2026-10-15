'use client';
import JusticeDocuments from './JusticeDocuments';
import PartyChairElection from './PartyChairElection';
import {isStageWorkOpen} from './stageWorkStatus';
import {useEffect,useMemo,useRef,useState,type ComponentType} from 'react';
import {latestPartyDocuments,latestPartyDocument,partyDocumentVersionLabel,partyDocumentVerdict} from './partyDocumentVersions';
import {IconAction} from '../ui/IconAction';
import {ChevronDown,FileText,PencilLine,Plus,Trash2,UserPlus,UsersRound} from 'lucide-react';
import StyledSelect from '../ui/StyledSelect';
import ProfileAvatar from './ProfileAvatar';
import PartyLogoEditor from './PartyLogoEditor';
import type {PartyDocument} from './types';
import type {ReturnTypeRepublic} from './viewTypes';
const DOCS:{kind:PartyDocument['doc_kind'];title:string;template:string}[]=[{kind:'application',title:'Заявление о регистрации',template:'party_application'},{kind:'charter',title:'Устав',template:'party_charter'},{kind:'program',title:'Программа',template:'party_program'},{kind:'fee',title:'Сведения об уплате госпошлины',template:'party_fee'},{kind:'symbol',title:'Символика',template:'party_symbol'},{kind:'congress_minutes',title:'Учредительный съезд',template:'party_congress'}];
const statusLabel:Record<string,string>={registered:'Зарегистрирована',submitted:'На регистрации',draft:'Пакет готовится',revision:'На доработке',rejected:'Регистрация отклонена'};
function PartyDisclosureSummary({icon:Icon,title,meta}:{icon:ComponentType<{size?:number}>;title:string;meta?:string}){
 return <summary className="civicPartyDisclosureSummary"><span className="civicPartyDisclosureIcon" aria-hidden="true"><Icon size={20}/></span><span className="civicPartyDisclosureText"><b>{title}</b>{meta&&<small>{meta}</small>}</span><span className="civicPartyDisclosureChevron" aria-hidden="true"><ChevronDown size={19}/></span></summary>;
}
export default function PartiesView({g}:{g:ReturnTypeRepublic}){
 const {parties,members,profiles,partyDocuments,partyInvitations,partyMandates,me,teacher}=g;
 const [selectedId,setSelectedId]=useState(''),[query,setQuery]=useState(''),[description,setDescription]=useState(''),[busy,setBusy]=useState(false),[inviteUser,setInviteUser]=useState(''),[name,setName]=useState(''),[ideology,setIdeology]=useState('');
 const [deletingPartyId,setDeletingPartyId]=useState('');
 const uploadInputs=useRef<Partial<Record<PartyDocument['doc_kind'],HTMLInputElement|null>>>({});
 const uploadInFlight=useRef(false);
 const registrationPackageRef=useRef<HTMLDetailsElement>(null);
 const [documentNotice,setDocumentNotice]=useState<{partyId:string;docKind:PartyDocument['doc_kind'];kind:'success'|'error';message:string}|null>(null);
 const [inviteFeedback,setInviteFeedback]=useState<{partyId:string;kind:'success'|'error';message:string}|null>(null);
 const stageOne=g.stages.find(s=>s.stage_no===1);
 const partyFormationOpen=isStageWorkOpen(g.game,stageOne);
 const canCreate=partyFormationOpen&&(!!teacher||(me?.kind==='student'&&!me.team&&!me.roster_archived_at));
 const ranked=useMemo(()=>[...parties].filter(p=>!query.trim()||[p.name,p.ideology,p.description].join(' ').toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.support-a.support),[parties,query]);
 const selected=parties.find(p=>p.id===selectedId)||parties.find(p=>p.name===me?.team)||ranked[0],own=!!selected&&(teacher||selected.name===me?.team),canEditDescription=partyFormationOpen&&!!selected&&(teacher||selected.leader_user_id===me?.user_id),canUploadLogo=partyFormationOpen&&!!selected&&(teacher||me?.kind==='student'&&!me.roster_archived_at&&selected.name===me.team),staff=members.filter(m=>m.kind==='student'&&!m.roster_archived_at&&m.team===selected?.name),leader=members.find(m=>m.user_id===selected?.leader_user_id),docs=partyDocuments.filter(d=>d.party_id===selected?.id),
 latestDocs=latestPartyDocuments(docs),
 revisionVersions=latestDocs.filter(d=>d.status==='revision').map(d=>d.id).sort().join(','),
 certificateIssued=!!selected&&g.formalDocuments.some(d=>d.doc_type==='party_certificate'&&d.metadata?.party_id===selected.id),
 publicDocs=selected?.registration_status==='registered'&&certificateIssued?
  latestDocs.filter(d=>['charter','program','symbol','congress_minutes'].includes(d.doc_kind)&&d.status==='accepted'):[],free=members.filter(m=>m.kind==='student'&&!m.roster_archived_at&&!m.team),pending=partyInvitations.filter(i=>i.party_id===selected?.id&&i.status==='pending'),inbox=partyInvitations.filter(i=>i.invited_user_id===me?.user_id&&i.status==='pending');
 const reviewedCount=DOCS.filter(kind=>latestDocs.some(d=>d.doc_kind===kind.kind&&d.status==='accepted')).length;
 const returnedCount=DOCS.filter(kind=>latestDocs.some(d=>d.doc_kind===kind.kind&&d.status==='revision')).length;
 const registrationSummary=selected?.registration_status==='registered'?'Регистрация завершена':selected?.registration_status==='rejected'?'В регистрации отказано':selected?.registration_status==='revision'||returnedCount>0?'Требуется доработка документов':selected?.registration_status==='submitted'?'Документы рассматриваются Минюстом':'Подготовка регистрационного пакета';
 const canInvite=partyFormationOpen&&!!selected&&!!me&&!me.roster_archived_at&&(teacher||me.kind==='student'&&me.team===selected.name);
 const inviteClosed=!!selected?.leader_user_id;
 const workflowCount=partyInvitations.filter(i=>i.game_id===g.game?.id&&i.status==='pending'&&i.invited_user_id===me?.user_id).length;
 useEffect(()=>{if(revisionVersions&&registrationPackageRef.current)registrationPackageRef.current.open=true;},[revisionVersions,selected?.id]);
 async function saveDescription(){if(!selected)return;setBusy(true);try{await g.savePartyIdentity(selected.id,description||selected.description||'')}finally{setBusy(false)}}
 async function saveLogo(file:File):Promise<boolean>{if(!selected)return false;setBusy(true);try{return await g.savePartyIdentity(selected.id,undefined,file)}finally{setBusy(false)}}
 async function upload(partyId:string,kind:PartyDocument['doc_kind'],title:string,file:File){
  if(!selected||selected.id!==partyId||busy||uploadInFlight.current||selected.registration_status==='registered'||!(teacher||me?.kind==='student'&&!me.roster_archived_at&&me.team===selected.name))return;
  uploadInFlight.current=true;
  setBusy(true);setDocumentNotice(null);
  try{
   const ok=await g.uploadPartyDocument(partyId,kind,title,file);
   setDocumentNotice({partyId,docKind:kind,kind:ok?'success':'error',message:ok?'Версия документа направлена в Минюст на рассмотрение.':'Загрузку не удалось подтвердить. Проверьте сообщение об ошибке и повторите попытку.'});
  }catch(e){
   g.setError(e);
   setDocumentNotice({partyId,docKind:kind,kind:'error',message:'Не удалось загрузить документ. Повторите попытку.'});
  }finally{uploadInFlight.current=false;setBusy(false)}
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
  {selected&&<section className="civicPartyPublic"><header><span className="civicPartyLogo" style={{background:selected.color}}>{selected.logo_url?<img src={selected.logo_url} alt={'Эмблема: '+selected.name}/>:selected.name.slice(0,1)}</span><div><h2>{selected.name}</h2><p>{selected.ideology||'Идеология не указана'}</p></div><span>{statusLabel[selected.registration_status]}</span></header><p className="civicPartyDescription">{selected.description||'Публичное описание пока не опубликовано.'}</p><div className="civicPartyFacts"><span><b>{selected.support}%</b> поддержка</span><span><b>{selected.mandates}</b> мандатов</span><span><b>{selected.regions}</b> регионов</span><span><b>{staff.length}</b> участников</span></div>
   <div className="civicPartyLeader"><span className="eventVoter"><ProfileAvatar name={leader?.full_name||'Не назначен'} src={profiles.find(p=>p.user_id===leader?.user_id)?.avatar_url}/></span><div><small>Председатель партии</small><b>{leader?.full_name||'Не назначен'}</b></div></div>
   <PartyChairElection g={g} party={selected}/><section className="civicPublicDocs"><h3>Публичные документы</h3>{publicDocs.length?publicDocs.map(d=><a key={d.id} href={d.url||undefined} target="_blank" rel="noreferrer"><div><b>{DOCS.find(x=>x.kind===d.doc_kind)?.title||d.title}</b><span>{d.title}</span><small>{d.file_name}</small></div><span>Открыть</span></a>):<p>Документы появятся после принятия последних версий всего регистрационного пакета, решения о регистрации и выдачи свидетельства.</p>}</section>
   {canInvite&&<details className="civicPartyEditor" data-party-invite-panel><PartyDisclosureSummary icon={UserPlus} title="Пригласить участника" meta={inviteClosed?'Приём закрыт. Председатель избран.':'Ожидают ответа: '+pending.length+' · приглашать можно только студентов'}/>
    {inviteClosed&&<p className="civicPartyInviteFeedback" role="status">Приём приглашений завершён: председатель партии уже избран. Новые приглашения запрещены правилами первого этапа.</p>}
    <StyledSelect label="Студент" value={inviteUser} onChange={value=>{setInviteUser(value);setInviteFeedback(null)}} disabled={busy||inviteClosed} options={[{value:'',label:'Выберите участника'},...free.map(m=>({value:m.user_id,label:m.full_name}))]}/>
    <button type="button" className="primary" disabled={!inviteUser||busy||inviteClosed} onClick={()=>void sendPartyInvite()}>{busy?'Отправка…':'Пригласить'}</button>
    {!inviteClosed&&inviteFeedback?.partyId===selected.id&&<p className={'civicPartyInviteFeedback '+(inviteFeedback.kind==='error'?'isError':'isSuccess')} role={inviteFeedback.kind==='error'?'alert':'status'}>{inviteFeedback.message}</p>}
    {pending.map(i=><div className="civicPendingInvite" key={i.id}><span>{g.names[i.invited_user_id]}</span><IconAction variant="remove" label="Отменить приглашение" onClick={()=>void g.cancelPartyInvitation(i.id)}/></div>)}
   </details>}
   <details className="civicPartyRoster"><PartyDisclosureSummary icon={UsersRound} title="Состав партии" meta={staff.length+' участников'}/><ul>{staff.map(m=><li key={m.user_id}><span className="eventVoter"><ProfileAvatar name={m.full_name} src={profiles.find(p=>p.user_id===m.user_id)?.avatar_url}/></span><div><b>{m.full_name}</b><small>{m.user_id===selected.leader_user_id?'Председатель партии «'+selected.name+'»':m.role_title||'Участник'}</small></div><span>{partyMandates.find(a=>a.user_id===m.user_id)?.base_mandates||0} мандатов</span></li>)}</ul></details>
   {(canEditDescription||canUploadLogo)&&<details className="civicPartyEditor"><PartyDisclosureSummary icon={PencilLine} title="Оформление партии" meta="Эмблема и публичное описание"/>{canEditDescription&&<><label>Описание<textarea rows={4} value={description||selected.description||''} onChange={e=>setDescription(e.target.value)}/></label><button className="secondary" disabled={busy} onClick={()=>void saveDescription()}>Сохранить описание</button></>}{canUploadLogo&&<PartyLogoEditor key={selected.id} partyName={selected.name} disabled={busy} onSave={saveLogo}/>}</details>}
   {(own||(selected.registration_status==='registered'&&certificateIssued))&&
    <fieldset className="gosPartyStageFieldset" disabled={!partyFormationOpen}><JusticeDocuments g={g} partyId={selected.id}/></fieldset>}
   {own&&<details ref={registrationPackageRef} className={"civicPartyPackage"+(revisionVersions?" hasRevision":"")}>
    <PartyDisclosureSummary icon={FileText} title="Документы и регистрация партии" meta={"Принято "+reviewedCount+" из "+DOCS.length+" · "+docs.length+" версий"}/>
    <div className="partyRegistrationOverview" role="status">
     <div className="partyRegistrationOverviewCopy">
      <b>{registrationSummary}</b>
      <small>{returnedCount>0?"На доработке: "+returnedCount+". Загрузите новые версии отмеченных документов.":selected.registration_status==='registered'?"Регистрационные документы приняты. Свидетельство доступно в документах Минюста.":"Статус каждого документа указан ниже. Предыдущие версии доступны в истории."}</small>
     </div>
     <span className={"partyRegistrationOverviewProgress"+(returnedCount>0?" isRevision":"")}>{reviewedCount} / {DOCS.length}</span>
    </div>
    {selected.registration_note&&<details className="partyRegistrationDecision">
     <summary>Полный текст решения Минюста</summary>
     <p>{selected.registration_note}</p>
    </details>}
    <div className="civicPartyFiles" aria-label="Регистрационные документы партии">
     {DOCS.map(kind=>{
      const current=latestPartyDocument(docs,kind.kind);
      const history=docs.filter(d=>d.doc_kind===kind.kind).sort((a,b)=>(b.version_no??1)-(a.version_no??1)||b.created_at.localeCompare(a.created_at));
      const canUpload=selected.registration_status!=='registered'&&(teacher||me?.kind==='student'&&!me.roster_archived_at&&me.team===selected.name);
      const nextVersion=(current?.version_no??0)+1;
      return <article className={"partyRegistrationDoc"+(current?.status==="revision"?" isRevision":"")} key={kind.kind}>
       <div className="partyRegistrationDocTop">
        <div className="partyRegistrationDocIdentity"><b>{kind.title}</b>
         <span className="partyRegistrationDocStatus" role={current?.status==="revision"?"alert":undefined}>{current?partyDocumentVersionLabel(current)+" · "+partyDocumentVerdict(current):"Не загружен"}</span>
        </div>
        <div className="partyRegistrationDocActions">
         {current?.url&&<a href={current.url} target="_blank" rel="noreferrer" aria-label={"Открыть "+kind.title+" "+partyDocumentVersionLabel(current)}>Открыть</a>}
         {canUpload&&<>
          <input type="file" className="partyRegistrationHiddenInput" tabIndex={-1} aria-label={"Выбрать файл: "+kind.title}
           accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp"
           ref={node=>{uploadInputs.current[kind.kind]=node}}
           onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void upload(selected.id,kind.kind,kind.title,file)}}/>
          <button type="button" className="secondary" disabled={busy} onClick={()=>uploadInputs.current[kind.kind]?.click()}>
           {busy?"Загрузка…":"Загрузить В"+nextVersion}
          </button>
         </>}
        </div>
       </div>
       {current?.status==="revision"&&<p className="partyRegistrationRevisionNote"><b>Документ возвращён на доработку.</b> {current.note||"Ознакомьтесь с решением Минюста и загрузите исправленную версию."}</p>}
       {current?.status!=="revision"&&current?.note&&<p className="partyRegistrationReviewNote">Заключение Минюста: {current.note}</p>}
       {documentNotice?.partyId===selected.id&&documentNotice.docKind===kind.kind&&<p className={"civicPartyInviteFeedback "+(documentNotice.kind==="error"?"isError":"isSuccess")} role={documentNotice.kind==="error"?"alert":"status"}>{documentNotice.message}</p>}
       {history.length>1&&<details className="partyRegistrationDocHistory"><summary>Предыдущие версии ({history.length-1})</summary>
        {history.slice(1).map(d=><p key={d.id}>{partyDocumentVersionLabel(d)} · {partyDocumentVerdict(d)} ·
         {d.url?<a href={d.url} target="_blank" rel="noreferrer">Открыть файл</a>:"Файл недоступен"}
         {d.note&&<small> · {d.note}</small>}</p>)}
       </details>}
      </article>;
     })}
     {!!selected.leader_user_id&&partyFormationOpen&&selected.registration_status!=='registered'&&
      <div className="partyRegistrationFooter">
       <button type="button" className="primary" disabled={busy||!DOCS.every(req=>latestDocs.some(d=>d.doc_kind===req.kind&&d.status!=="revision"))} onClick={()=>void g.submitPartyRegistration(selected.id)}>Направить пакет на регистрацию</button>
       <details className="partyRegistrationLegal"><summary>Нормативные требования к документам</summary>
        <a href="https://pravo.gov.ru/proxy/ips/?docbody=&nd=102071991" target="_blank" rel="noreferrer">Федеральный закон № 95-ФЗ</a>
        <a href="https://minjust.gov.ru/ru/documents/7719/" target="_blank" rel="noreferrer">Официальные формы Минюста · Приказ № 333</a>
       </details>
      </div>}
    </div>
   </details>}

  </section>}
  {canCreate&&<details open className="civicPartyEditor"><PartyDisclosureSummary icon={Plus} title="Создать партию" meta="Новая политическая организация"/><label>Название<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Идеология<input value={ideology} onChange={e=>setIdeology(e.target.value)}/></label><button className="primary" disabled={busy||!name.trim()||!ideology.trim()} onClick={async()=>{if(await g.createParty(name,ideology)){setName('');setIdeology('')}}}>Создать</button></details>}
 </div>;
}
