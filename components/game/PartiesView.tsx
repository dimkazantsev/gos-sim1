'use client';
import {IconAction} from '../ui/IconAction';
import {useMemo,useState,type CSSProperties} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {PartyDocument} from './types';
import MediaUploadButton from './MediaUploadButton';
import StyledSelect from '../ui/StyledSelect';

const DOCS:{kind:PartyDocument['doc_kind'];title:string;rule:string}[]=[
 {kind:'application',title:'Заявление о регистрации',rule:'Пункт а ст. 16 95-ФЗ'},
 {kind:'charter',title:'Устав политической партии',rule:'Пункт б ст. 16 95-ФЗ'},
 {kind:'program',title:'Программа партии',rule:'Не менее 10 положений по правилам игры'},
 {kind:'fee',title:'Документ об уплате госпошлины',rule:'Требование сценария игры; актуальную редакцию закона проверяйте отдельно'},
 {kind:'symbol',title:'Символика / эмблема',rule:'Отдельная иллюстрация по правилам игры'},
 {kind:'congress_minutes',title:'Решения учредительного съезда',rule:'Протокол / решения съезда'}
];

export default function PartiesView({g}:{g:ReturnTypeRepublic}){
 const {parties,members,profiles,partyDocuments,partyInvitations,partyMandates,partyAgreements,votes,currentStage,me,teacher,createParty,updateParty,setPartyLeader,setPartyMandates,inviteToParty,respondPartyInvitation,cancelPartyInvitation,removePartyMember,proposePartyAgreement,respondPartyAgreement,submitPartyRegistration,reviewPartyRegistration,applyPartyGhostLoss,drawGhostVoting,clearPartyGhostLoss,savePartyIdentity,uploadPartyDocument,reviewPartyDocument}=g;
 const [name,setName]=useState(''),[ideology,setIdeology]=useState('');
 const [selectedId,setSelectedId]=useState('');
 const [desc,setDesc]=useState('');
 const [logo,setLogo]=useState<File|null>(null);
 const [docKind,setDocKind]=useState<PartyDocument['doc_kind']>('application');
 const [docFile,setDocFile]=useState<File|null>(null);
 const [docTitle,setDocTitle]=useState('');
 const [inviteUser,setInviteUser]=useState('');
 const [ghostLoss,setGhostLoss]=useState(25);
 const [ghostDraw,setGhostDraw]=useState<{total_loss:number;result:{party_id:string;party_name:string;loss:number}[]}|null>(null);
 const [agreementParty,setAgreementParty]=useState('');
 const [agreementTitle,setAgreementTitle]=useState('');
 const [agreementTerms,setAgreementTerms]=useState('');
 const [agreementVote,setAgreementVote]=useState('');
 const [myPromise,setMyPromise]=useState<''|'yes'|'no'>('');
 const [theirPromise,setTheirPromise]=useState<''|'yes'|'no'>('');
 const [registrationNote,setRegistrationNote]=useState('');
 const [busy,setBusy]=useState(false);

 const ranked=useMemo(()=>[...parties].sort((a,b)=>Number(b.support)-Number(a.support)||b.regions-a.regions||b.mandates-a.mandates),[parties]);
 const myParty=parties.find(p=>p.name===me?.team);
 const selected=parties.find(p=>p.id===selectedId)||myParty||ranked[0];
 const partyMembers=selected?members.filter(m=>m.kind==='student'&&m.team===selected.name):[];
 const leader=selected?members.find(m=>m.user_id===selected.leader_user_id):undefined;
 const docs=selected?partyDocuments.filter(d=>d.party_id===selected.id):[];
 const registrationComplete=DOCS.every(req=>docs.some(d=>d.doc_kind===req.kind));
 const registrationAccepted=DOCS.every(req=>docs.some(d=>d.doc_kind===req.kind&&d.status==='accepted'));
 const canEditIdentity=!!selected&&(teacher||selected.leader_user_id===me?.user_id);
 const isLeader=!!selected&&selected.leader_user_id===me?.user_id;
 const freeStudents=members.filter(m=>m.kind==='student'&&!m.team);
 const selectedAllocations=selected?partyMandates.filter(x=>x.party_id===selected.id):[];
 const pendingForSelected=selected?partyInvitations.filter(i=>i.party_id===selected.id&&i.status==='pending'):[];
 const myPending=partyInvitations.filter(i=>i.invited_user_id===me?.user_id&&i.status==='pending');
 const chamberMandates=parties.reduce((a,p)=>a+Number(p.mandates||0),0);
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const agreementPhase=(currentStage?.stage_no||1)<4;
 const factionVotes=votes.filter(v=>v.stage_no<4&&v.voting_mode==='faction'&&v.status==='open');
 const incomingAgreements=ledParty?partyAgreements.filter(a=>a.counterparty_party_id===ledParty.id&&a.status==='proposed'):[];
 const agreementPartyName=(id:string)=>parties.find(p=>p.id===id)?.name||'Фракция';
 const agreementVoteTitle=(id:string|null)=>id?votes.find(v=>v.id===id)?.title||'Связанное голосование':'Общее обязательство';

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

  <section className="ghostWarRoom">
   <div className="ghostWarCopy"><small>СТОХАСТИЧЕСКИЙ РИСК · ЭТАП 5+</small><h2>Ghost voting</h2><p>Перед заседанием ГД система временно выводит из голосования 25–50 депутатов и распределяет потерю между случайно выбранными фракциями. Это меняет реальную коалиционную математику ближайшего заседания.</p></div>
   <div className="ghostWarState">
    {parties.some(p=>p.ghost_active)?<div className="ghostActiveParties">{parties.filter(p=>p.ghost_active).map(p=><span key={p.id} style={{'--party-color':p.color} as CSSProperties}><i/>{p.name}<b>−{p.ghost_loss_current}</b></span>)}</div>:<div className="ghostQuiet"><b>Состав полный</b><span>Временных потерь мандатов нет</span></div>}
    {ghostDraw&&<div className="ghostLastDraw"><small>ПОСЛЕДНЯЯ ЖЕРЕБЬЁВКА · −{ghostDraw.total_loss}</small>{ghostDraw.result.map(x=><span key={x.party_id}>{x.party_name}<b>−{x.loss}</b></span>)}</div>}
   </div>
   {teacher&&<div className="ghostWarControls">
    <label>Общий объём отсутствующих<input type="number" min="25" max="50" value={ghostLoss} onChange={e=>setGhostLoss(Math.max(25,Math.min(50,Number(e.target.value)||25)))}/></label>
    <button className="primary" disabled={busy||parties.every(p=>p.mandates<=0)} onClick={async()=>{setBusy(true);const x=await drawGhostVoting(ghostLoss);if(x)setGhostDraw(x);setBusy(false)}}>⚡ Провести жеребьёвку</button>
    {parties.some(p=>p.ghost_active)&&<button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);await clearPartyGhostLoss();setGhostDraw(null);setBusy(false)}}>↺ Завершить заседание</button>}
    <small>Ручную корректировку отдельной фракции можно сделать в её карточке ниже.</small>
   </div>}
  </section>

  {agreementPhase&&<section className="agreementExchange">
   <div className="agreementExchangeHead">
    <div><small>ПЕРЕГОВОРЫ · ОБЯЗАТЕЛЬСТВА</small><h2>Межфракционные соглашения</h2><p>До формирования парламента принятое соглашение становится обязательством. Если оно привязано к фракционному голосованию, сервер не позволит стороне проголосовать вопреки принятому обещанию.</p></div>
    <div className="agreementRule"><b>Правило игры</b><span>Договорённости обязательны до этапа формирования парламента; после этого решения подчиняются институциональным и правовым процедурам.</span></div>
   </div>

   {incomingAgreements.length>0&&<div className="agreementInbox"><small>ТРЕБУЕТСЯ ВАШЕ РЕШЕНИЕ</small>{incomingAgreements.map(a=><article key={a.id}><div><b>{a.title}</b><span>{agreementPartyName(a.proposer_party_id)} → {agreementPartyName(a.counterparty_party_id)}</span><p>{a.terms}</p></div><div><button className="primary" onClick={()=>void respondPartyAgreement(a.id,true)}>Принять обязательство</button><button className="secondary" onClick={()=>void respondPartyAgreement(a.id,false)}>Отклонить</button></div></article>)}</div>}

   {ledParty&&<details className="agreementComposer">
    <summary><div><b>Предложить сделку другой фракции</b><span>Можно сделать соглашение общим или привязать к конкретному открытому голосованию</span></div><i>+</i></summary>
    <div className="agreementComposerBody">
     <StyledSelect label="Контрагент" value={agreementParty} onChange={setAgreementParty} options={[{value:'',label:'Выберите фракцию…'},...parties.filter(p=>p.id!==ledParty.id).map(p=>({value:p.id,label:p.name}))]}/>
     <label>Название сделки<input value={agreementTitle} onChange={e=>setAgreementTitle(e.target.value)} placeholder="Например: поддержка модели ИС в обмен на региональную договорённость"/></label>
     <label className="agreementTerms">Условия<textarea rows={4} value={agreementTerms} onChange={e=>setAgreementTerms(e.target.value)} placeholder="Что именно обещает каждая сторона, в какой момент и ради какого обмена?"/></label>
     <StyledSelect label="Связанное голосование" value={agreementVote} onChange={setAgreementVote} options={[{value:'',label:'Без привязки'},...factionVotes.map(v=>({value:v.id,label:v.stage_no+'. '+v.title}))]}/>
     {agreementVote&&<><StyledSelect label="Наша обещанная позиция" value={myPromise} onChange={v=>setMyPromise(v as ''|'yes'|'no')} options={[{value:'',label:'Не фиксировать'},{value:'yes',label:'За'},{value:'no',label:'Против'}]}/><StyledSelect label="Позиция партнёра" value={theirPromise} onChange={v=>setTheirPromise(v as ''|'yes'|'no')} options={[{value:'',label:'Не фиксировать'},{value:'yes',label:'За'},{value:'no',label:'Против'}]}/></>}
     <button className="primary" disabled={busy||!agreementParty||agreementTitle.trim().length<3||agreementTerms.trim().length<10} onClick={async()=>{setBusy(true);const ok=await proposePartyAgreement({counterpartyPartyId:agreementParty,title:agreementTitle.trim(),terms:agreementTerms.trim(),targetVoteId:agreementVote||null,proposerChoice:myPromise||null,counterpartyChoice:theirPromise||null});setBusy(false);if(ok){setAgreementTitle('');setAgreementTerms('');setAgreementVote('');setMyPromise('');setTheirPromise('')}}}>Отправить соглашение →</button>
    </div>
   </details>}

   <div className="agreementLedger">
    {partyAgreements.length===0?<div className="emptyState">Соглашений пока нет. Здесь появится проверяемая история коалиционных обменов.</div>:partyAgreements.map(a=><article key={a.id} className={'agreementCard '+a.status}>
     <header><span>{a.status==='accepted'?'●':a.status==='fulfilled'?'✓':a.status==='rejected'?'×':'○'}</span><div><b>{a.title}</b><small>{agreementPartyName(a.proposer_party_id)} ⇄ {agreementPartyName(a.counterparty_party_id)}</small></div><em>{a.status==='proposed'?'Ожидает ответа':a.status==='accepted'?'Обязательно':a.status==='fulfilled'?'Исполнено':a.status==='rejected'?'Отклонено':'Завершено'}</em></header>
     <p>{a.terms}</p>
     <footer><span>{agreementVoteTitle(a.target_vote_id)}</span>{a.proposer_choice&&<span>{agreementPartyName(a.proposer_party_id)}: {a.proposer_choice==='yes'?'ЗА':'ПРОТИВ'}</span>}{a.counterparty_choice&&<span>{agreementPartyName(a.counterparty_party_id)}: {a.counterparty_choice==='yes'?'ЗА':'ПРОТИВ'}</span>}</footer>
    </article>)}
   </div>
  </section>}

  {myPending.length>0&&<section className="partyInviteInbox">
   <div><small>ВАС ПРИГЛАСИЛИ</small><h2>Приглашения в партии</h2><p>Вступление произойдёт только после вашего подтверждения. После принятия система автоматически перераспределит депутатские мандаты между всеми студентами фракции.</p></div>
   <div className="partyInviteCards">{myPending.map(inv=>{const p=parties.find(x=>x.id===inv.party_id);const inviter=members.find(m=>m.user_id===inv.invited_by);return <article key={inv.id}><div className="invitePartyMark" style={{background:p?.color||'#6f7cff'}}>{p?.name.slice(0,2).toUpperCase()||'П'}</div><div><small>{inviter?.full_name?('Приглашает: '+inviter.full_name):'Приглашение в партию'}</small><b>{p?.name||'Партия'}</b><span>После вступления вы получите часть из {p?.mandates||0} мандатов фракции.</span></div><div><button className="primary" onClick={()=>void respondPartyInvitation(inv.id,true)}>Принять</button><button className="secondary" onClick={()=>void respondPartyInvitation(inv.id,false)}>Отклонить</button></div></article>})}</div>
  </section>}

  {teacher&&<details className="teacherDetails compactPartyCreate"><summary><div><b>Создать новую партию</b><span>Название и идеология; руководителя назначите после создания</span></div><i>+</i></summary><div className="teacherDetailsBody compactForm"><input aria-label="Название партии" value={name} onChange={e=>setName(e.target.value)} placeholder="Название партии"/><input aria-label="Идеология партии" value={ideology} onChange={e=>setIdeology(e.target.value)} placeholder="Идеология"/><button className="primary" onClick={create}>Создать</button></div></details>}

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
    {canEditIdentity&&<details className="inlineEditor"><summary>Редактировать визитку партии</summary><div><textarea aria-label="Описание партии" rows={4} value={desc||selected.description||''} onChange={e=>setDesc(e.target.value)} placeholder="Описание партии"/><MediaUploadButton files={logo?[logo]:[]} onChange={x=>setLogo(x[0]||null)} accept="image/jpeg,image/png,image/webp,image/gif" multiple={false} label="Логотип партии" hint="Загрузить изображение" variant="logo"/><button className="primary" disabled={busy} onClick={saveIdentity}>{busy?'Сохраняю…':'Сохранить'}</button></div></details>}
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
       {teacher&&<IconAction variant="remove" className="removePartyMember" onClick={()=>{if(confirm('Удалить студента из партии? Мандаты автоматически перераспределятся.'))void removePartyMember(selected.id,m.user_id)}} label={'Удалить участника '+m.full_name}/>}
      </article>})}
    </div>

    <div className="mandateMath"><b>{selected.mandates} мандатов ÷ {Math.max(1,partyMembers.length)} студентов</b><span>Система распределяет целые блоки максимально поровну; разница между участниками не превышает одного мандата.</span></div>

    {teacher&&<div className="partyTeacherControl">
     <StyledSelect label="Руководитель партии" value={selected.leader_user_id||''} onChange={v=>{if(v)void setPartyLeader(selected.id,v)}} options={[{value:'',label:'Назначить руководителя…'},...members.filter(m=>m.kind==='student').map(m=>({value:m.user_id,label:m.full_name+(m.team?' · '+m.team:'')}))]}/>
     <label>Мандаты партии<input key={selected.id+'-'+selected.mandates} type="number" min="0" max="450" defaultValue={selected.mandates} onBlur={e=>void setPartyMandates(selected.id,Math.max(0,Math.min(450,Number(e.target.value)||0)))}/></label>
     <label>Ручная потеря GV<input type="number" min="25" max="50" value={ghostLoss} onChange={e=>setGhostLoss(Math.max(25,Math.min(50,Number(e.target.value)||25)))}/></label>
     <button className="secondary" disabled={selected.mandates<=0} onClick={()=>void applyPartyGhostLoss(selected.id,ghostLoss)}>Применить вручную</button>
    </div>}

    {(isLeader||teacher)&&<div className="partyInviteManager">
     <div><small>НАБОР В ПАРТИЮ</small><h3>Пригласить студента</h3><p>Доступны только студенты, которые ещё не состоят ни в одной партии.</p></div>
     <div className="partyInviteComposer"><StyledSelect label="Студент для приглашения" value={inviteUser} onChange={setInviteUser} options={[{value:'',label:'Выберите студента…'},...freeStudents.map(s=>({value:s.user_id,label:s.full_name+' · '+(s.group_name||'без группы')}))]}/><button className="primary" disabled={!inviteUser||busy} onClick={invite}>Отправить приглашение</button></div>
     {pendingForSelected.length>0&&<div className="pendingInvites">{pendingForSelected.map(inv=>{const s=members.find(m=>m.user_id===inv.invited_user_id);return <div key={inv.id}><span>○</span><b>{s?.full_name||'Студент'}</b><small>Ожидается ответ</small><button onClick={()=>void cancelPartyInvitation(inv.id)}>Отменить</button></div>})}</div>}
    </div>}
   </article>
  </section>}

  {selected&&<section className="partyDocumentsSection">
   <div className="partyRegistrationStatus">
    <div><small>ГОСУДАРСТВЕННАЯ РЕГИСТРАЦИЯ · ИГРОВОЙ МИНЮСТ</small><h3>{selected.registration_status==='registered'?'Партия зарегистрирована':selected.registration_status==='submitted'?'Пакет рассматривается':selected.registration_status==='revision'?'Возвращено на доработку':selected.registration_status==='rejected'?'В регистрации отказано':'Пакет формируется'}</h3>{selected.registration_note&&<p>{selected.registration_note}</p>}<span>{docs.length}/{DOCS.length} документов · {docs.filter(d=>d.status==='accepted').length}/{DOCS.length} принято</span></div>
    {isLeader&&selected.registration_status!=='registered'&&selected.registration_status!=='submitted'&&<button className="primary" disabled={busy||!registrationComplete} onClick={async()=>{setBusy(true);await submitPartyRegistration(selected.id);setBusy(false)}}>Подать пакет в Минюст →</button>}
    {teacher&&selected.registration_status==='submitted'&&<div className="partyRegistrationDecision"><textarea rows={2} value={registrationNote} onChange={e=>setRegistrationNote(e.target.value)} placeholder="Комментарий Минюста / основания решения"/><button disabled={busy} onClick={async()=>{setBusy(true);await reviewPartyRegistration(selected.id,'revision',registrationNote);setBusy(false)}}>↺ Доработка</button><button disabled={busy} onClick={async()=>{setBusy(true);await reviewPartyRegistration(selected.id,'rejected',registrationNote);setBusy(false)}}>Отказать</button><button className="primary" disabled={busy||!registrationAccepted} onClick={async()=>{setBusy(true);await reviewPartyRegistration(selected.id,'registered',registrationNote);setBusy(false)}}>✓ Зарегистрировать</button></div>}
   </div>
   <div className="partySectionTitle"><div><small>УЧРЕДИТЕЛЬНЫЙ ПАКЕТ</small><h2>Документы партии</h2></div><span>{docs.length} загружено</span></div>
   <div className="requiredDocs">
    {DOCS.map(req=>{const d=docs.find(x=>x.doc_kind===req.kind);return <article className={d?'requiredDoc complete':'requiredDoc'} key={req.kind}><div className="docState">{d?'✓':'○'}</div><div><b>{req.title}</b><span>{req.rule}</span>{d&&<a href={d.url||'#'} target="_blank" rel="noreferrer">{d.file_name}</a>}</div>{d&&<em className={`docReview ${d.status}`}>{d.status==='accepted'?'Принято':d.status==='revision'?'На доработку':'Загружено'}</em>}</article>})}
   </div>
   {canEditIdentity&&<div className="partyUpload surface"><div><small>ЗАГРУЗИТЬ ДОКУМЕНТ</small><h3>Добавить в партийное дело</h3></div><StyledSelect label="Тип партийного документа" value={docKind} onChange={v=>setDocKind(v as PartyDocument['doc_kind'])} options={DOCS.map(x=>({value:x.kind,label:x.title}))}/><input aria-label="Название партийного документа" value={docTitle} onChange={e=>setDocTitle(e.target.value)} placeholder="Название документа"/><label className="filePicker">Выбрать файл<input type="file" accept=".pdf,.doc,.docx,.txt,image/jpeg,image/png,image/webp" onChange={e=>setDocFile(e.target.files?.[0]||null)}/></label><button className="primary" disabled={!docFile||busy} onClick={uploadDoc}>{busy?'Загрузка…':'Загрузить'}</button></div>}
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