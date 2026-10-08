'use client';

import {useRef,useState} from 'react';
import {useGameTableSync} from './useGameTableSync';
import {
 ArrowRight,Building2,Check,ClipboardCheck,Landmark,MessageCircle,
 ShieldCheck,Trash2,UserRoundPlus,UsersRound,Vote,X
} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import InstitutionRegistrationPanel from './InstitutionRegistrationPanel';
import type {ReturnTypeRepublic} from './viewTypes';
import {stageRoleTitles} from './stageRoles';

type Structure={
 game_id:string;
 formal_document_id:string|null;
 social_title:string;
 economic_title:string;
 defence_title:string;
 foreign_title:string;
 internal_title:string;
 status:'draft'|'submitted'|'approved'|'revision';
 note:string|null;
};

type Nomination={
 id:string;
 game_id:string;
 office_key:string;
 office_title:string;
 office_kind:'prime_minister'|'deputy_pm'|'duma_minister'|'security_minister'|'central_bank_chair';
 route:'president_to_duma'|'pm_to_duma'|'president_after_sf';
 candidate_user_id:string|null;
 candidate_name:string;
 attempt_no:number;
 status:'submitted'|'vote_open'|'approved'|'rejected'|'consultation_pending'|'consulted'|'appointed'|'withdrawn';
 vote_id:string|null;
 formal_document_id:string|null;
 appointment_document_id:string|null;
 note:string|null;
 created_at:string;
};

type PortfolioKey='social'|'economic'|'defence'|'foreign'|'internal';

const DEFAULT_TITLES:Record<PortfolioKey,string>={
 social:'Министерство по социальной политике',
 economic:'Министерство по экономической политике',
 defence:'Министерство по обороне и внутренней безопасности',
 foreign:'Министерство по внешней политике',
 internal:'Министерство по внутренней политике и государству'
};

const PORTFOLIOS:Array<{key:PortfolioKey;label:string;route:'duma'|'sf';scope:string}>= [
 {key:'social',label:'Социальная политика',route:'duma',scope:'Труд, демография, культура, образование, здравоохранение'},
 {key:'economic',label:'Экономическая политика',route:'duma',scope:'Финансы, налоги, транспорт, энергетика и развитие'},
 {key:'foreign',label:'Внешняя политика',route:'duma',scope:'Международные отношения и внешнеполитическая координация'},
 {key:'defence',label:'Оборона и безопасность',route:'sf',scope:'Оборона, безопасность государства и силовой блок'},
 {key:'internal',label:'Внутренняя политика и государство',route:'sf',scope:'ОГВ, ОМС, МВД, МЧС, национальности, гражданское общество'}
];

const STATUS:Record<Nomination['status'],string>={
 submitted:'Внесена в повестку',
 vote_open:'Голосование открыто',
 approved:'Утверждена Государственной Думой',
 rejected:'Отклонена Государственной Думой',
 consultation_pending:'Ожидает консультации с Советом Федерации',
 consulted:'Консультация проведена',
 appointed:'Назначен(а)',
 withdrawn:'Отозвана'
};


type NomineeOption={
 user_id:string;
 full_name:string;
 role_title:string|null;
};

function NomineeFields({
 slot,disabled=false,students,selectedUserId,value,onSelect,onNameChange
}:{
 slot:string;
 disabled?:boolean;
 students:NomineeOption[];
 selectedUserId:string;
 value:string;
 onSelect:(slot:string,userId:string)=>void;
 onNameChange:(slot:string,name:string)=>void;
}){
 const invalid=value.trim().length>0&&value.trim().length<3;
 return <div className="gov8NomineeFields">
  <label>Участник игры
   <select
    disabled={disabled||students.length===0}
    value={selectedUserId}
    onChange={e=>onSelect(slot,e.target.value)}
   >
    <option value="">{students.length?'Выберите участника':'Нет активных участников — используйте Ф.И.О.'}</option>
    {students.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.role_title||'участник'}</option>)}
   </select>
  </label>
  <label>Ф.И.О. кандидатуры
   <input
    disabled={disabled}
    value={value}
    onChange={e=>onNameChange(slot,e.target.value)}
    placeholder="Введите Ф.И.О. вручную"
    autoComplete="off"
   />
  </label>
  <small className={'gov8FieldError '+(invalid?'isVisible':'isHidden')} aria-live="polite" aria-hidden={!invalid}>
   Введите не менее 3 символов.
  </small>
 </div>;
}

export default function GovernmentStage8Workspace({
 g,onOpenVotes,onOpenStage,onOpenDocument,onNavigate
}:{
 g:ReturnTypeRepublic;
 onOpenVotes:(voteId?:string)=>void;
 onOpenStage?:(stageNo:number)=>void;
 onOpenDocument?:(id:string)=>void;
 onNavigate?:(view:'documents'|'actions'|'votes')=>void;
}){
 const {game,me,teacher,members,votes,setError}=g;
 const [rows,setRows]=useState<Nomination[]>([]);
 const [structure,setStructure]=useState<Structure|null>(null);
 const [titles,setTitles]=useState<Record<PortfolioKey,string>>(DEFAULT_TITLES);
 const [structureNote,setStructureNote]=useState('');
 const [registrations,setRegistrations]=useState<Array<{user_id:string}>>([]);
 const [selected,setSelected]=useState<Record<string,string>>({});
 const [manual,setManual]=useState<Record<string,string>>({});
 const [consultNotes,setConsultNotes]=useState<Record<string,string>>({});
 const [deputyPortfolio,setDeputyPortfolio]=useState<PortfolioKey>('social');
 const [busy,setBusy]=useState<string|null>(null);
 const [registrationOpen,setRegistrationOpen]=useState(false);
 const structureDirty=useRef(false);

 const role=stageRoleTitles(g);
 const isPresident=role.includes('президент');
 const isPM=role.includes('председател')&&role.includes('правительств');
 const canPresident=teacher||isPresident;
 const canPM=teacher||isPM;
 const students=members.filter(m=>m.kind==='student');

 async function load(){
  if(!game)return;
  const [n,s,r]=await Promise.all([
   supabase.from('government_nominations').select('*').eq('game_id',game.id).eq('stage_no',8).order('created_at',{ascending:true}),
   supabase.from('government_structures').select('*').eq('game_id',game.id).maybeSingle(),
   supabase.from('institution_session_registrations').select('user_id').eq('game_id',game.id).eq('stage_no',8).eq('institution_key','gd')
  ]);
  const failure=[n,s,r].find(x=>x.error);if(failure?.error){setError(failure.error.message);return;}
  if(!n.error){
   const next=((n.data||[]) as Nomination[]).filter(x=>x.status!=='withdrawn');
   setRows(next);
   const deputy=[...next].reverse().find(x=>x.office_kind==='deputy_pm'&&!['rejected','withdrawn'].includes(x.status));
   if(deputy?.office_key.startsWith('ministry_')){
    const key=deputy.office_key.replace('ministry_','') as PortfolioKey;
    if(['social','economic','foreign'].includes(key))setDeputyPortfolio(key);
   }
  }
  if(!s.error){
   const x=(s.data||null) as Structure|null;
   setStructure(x);
   if(x&&!structureDirty.current)setTitles({
    social:x.social_title,economic:x.economic_title,defence:x.defence_title,
    foreign:x.foreign_title,internal:x.internal_title
   });
  }
  if(!r.error)setRegistrations(r.data||[]);
 }

 useGameTableSync(game?.id,['government_nominations','government_structures','institution_session_registrations','game_office_assignments','game_votes','game_ballots'],load,me?.user_id||'');

 if(!game||!me)return null;
 const activeGame=game;

 const latest=(officeKey:string)=>[...rows].reverse().find(x=>x.office_key===officeKey);
 const rejections=(officeKey:string)=>rows.filter(x=>x.office_key===officeKey&&x.status==='rejected').length;
 const pm=latest('prime_minister');
 const cbr=latest('central_bank_chair');
 const pmAppointed=rows.some(x=>x.office_kind==='prime_minister'&&x.status==='appointed');
 const structureApproved=structure?.status==='approved';
 const activeDeputy=rows.find(x=>x.office_kind==='deputy_pm'&&!['rejected','withdrawn'].includes(x.status));
 const allMinistersAppointed=PORTFOLIOS.every(p=>latest('ministry_'+p.key)?.status==='appointed');
 const phase=allMinistersAppointed?4:structureApproved?3:pmAppointed?2:1;

 const dumaRows=rows.filter(x=>x.route==='president_to_duma'||x.route==='pm_to_duma');
 const openDumaVotes=dumaRows.map(n=>n.vote_id?votes.find(v=>v.id===n.vote_id):undefined).filter(v=>v?.status==='open');
 const activeVoteId=openDumaVotes[0]?.id||undefined;
 const publicChannel=g.channels.find(c=>c.kind==='public'&&c.name!=='Вне игры'&&['Публичная политика','Общая беседа','Общий штаб','Общий чат'].includes(c.name))
  ||g.channels.find(c=>c.kind==='public'&&c.name!=='Вне игры');

 const nextAction=phase===1
  ?(!pm?'Президенту необходимо внести кандидатуру Председателя Правительства':pm.status==='submitted'?'Открыть голосование Государственной Думы':pm.status==='vote_open'?'Провести голосование по кандидатуре Председателя Правительства':pm.status==='approved'?'Президенту необходимо назначить утверждённого Председателя Правительства':pm.status==='rejected'&&pm.attempt_no<3?'Внести кандидатуру повторно':'Разрешить последствия трёх отклонений')
  :phase===2
   ?(!structure?'Председателю Правительства необходимо предложить структуру из пяти министерств':structure.status==='submitted'?'Президенту необходимо рассмотреть структуру Правительства':structure.status==='revision'?'Председателю Правительства необходимо переименовать министерства и представить структуру повторно':'Завершить утверждение структуры Правительства')
   :phase===3
    ?'Заполнить пять министерств: три кандидатуры проходят Государственную Думу, две — консультацию с Советом Федерации'
    :'Состав Правительства сформирован';

 const memberName=(id:string)=>students.find(m=>m.user_id===id)?.full_name||'';
 const candidateName=(slot:string)=>((manual[slot]||'').trim()||memberName(selected[slot]||'')).trim();

 async function submitNomination(slot:string,officeKey:string,officeTitle:string,officeKind:Nomination['office_kind']){
  const name=candidateName(slot);
  if(name.length<3)return;
  setBusy('submit:'+slot);
  const r=await supabase.rpc('submit_government_nomination',{
   p_game_id:activeGame.id,p_office_key:officeKey,p_office_title:officeTitle,
   p_office_kind:officeKind,p_candidate_user_id:selected[slot]||null,p_candidate_name:name
  });
  if(r.error)setError(r.error.message);
  else{
   setSelected(v=>({...v,[slot]:''}));
   setManual(v=>({...v,[slot]:''}));
   await load();
  }
  setBusy(null);
 }

 async function openVote(id:string){
  setBusy('vote:'+id);
  const r=await supabase.rpc('open_government_nomination_vote',{p_nomination_id:id});
  if(r.error)setError(r.error.message);
  else{
   await g.refresh();await load();onOpenVotes(String(r.data));
  }
  setBusy(null);
 }

 async function withdrawNomination(id:string,name:string){
  if(!window.confirm('Снять кандидатуру «'+name+'» с повестки? Связанное голосование будет отменено, а проект НПА помечен как снятый.'))return;
  setBusy('withdraw:'+id);
  const r=await supabase.rpc('withdraw_government_nomination',{p_nomination_id:id});
  if(r.error)setError(r.error.message);
  else{await g.refresh();await load()}
  setBusy(null);
 }

 async function appoint(id:string){
  setBusy('appoint:'+id);
  const r=await supabase.rpc('appoint_government_nominee',{p_nomination_id:id});
  if(r.error)setError(r.error.message);else{await g.refresh();await load()}
  setBusy(null);
 }

 async function appointAfterThree(id:string){
  setBusy('force-appoint:'+id);
  const r=await supabase.rpc('appoint_government_nominee_after_three_rejections',{p_nomination_id:id});
  if(r.error)setError(r.error.message);else{await g.refresh();await load()}
  setBusy(null);
 }

 async function consult(id:string){
  setBusy('consult:'+id);
  const r=await supabase.rpc('record_sf_consultation',{p_nomination_id:id,p_note:(consultNotes[id]||'').trim()||null});
  if(r.error)setError(r.error.message);else await load();
  setBusy(null);
 }

 async function saveStructure(submit:boolean){
  setBusy(submit?'structure-submit':'structure-save');
  const r=await supabase.rpc('save_government_structure',{
   p_game_id:activeGame.id,
   p_social_title:titles.social,p_economic_title:titles.economic,p_defence_title:titles.defence,
   p_foreign_title:titles.foreign,p_internal_title:titles.internal,p_submit:submit
  });
  if(r.error)setError(r.error.message);else{structureDirty.current=false;await load()}
  setBusy(null);
 }

 async function reviewStructure(action:'approve'|'revision'){
  setBusy('structure-review');
  const r=await supabase.rpc('review_government_structure',{
   p_game_id:activeGame.id,p_action:action,p_note:structureNote.trim()||null
  });
  if(r.error)setError(r.error.message);else{setStructureNote('');await load()}
  setBusy(null);
 }

 function openChat(){
  if(!publicChannel)return;
  g.setChannelId(publicChannel.id);g.setChatOpen(true);
 }

 function openVoting(id?:string|null){
  onOpenVotes(id||activeVoteId);
 }

 const stepState=(n:number)=>n<phase?'done':n===phase?'current':'locked';

 function handleNomineeSelect(slot:string,userId:string){
  setSelected(v=>({...v,[slot]:userId}));
  setManual(v=>({...v,[slot]:userId?memberName(userId):''}));
 }

 function handleNomineeNameChange(slot:string,name:string){
  const selectedName=memberName(selected[slot]||'');
  setManual(v=>({...v,[slot]:name}));
  if(selected[slot]&&name!==selectedName)setSelected(v=>({...v,[slot]:''}));
 }

 function AgendaRow({n,index}:{n:Nomination;index:number}){
  const vote=n.vote_id?votes.find(v=>v.id===n.vote_id):undefined;
  const rejects=rejections(n.office_key);

  let actionLabel='Ожидает решения';
  let actionKind:'primary'|'secondary'='secondary';
  let actionDisabled=true;
  let actionHandler:(()=>void)|null=null;

  if(teacher&&n.status==='submitted'){
   actionLabel='Открыть голосование';
   actionKind='primary';
   actionDisabled=false;
   actionHandler=()=>void openVote(n.id);
  }else if(vote?.status==='open'){
   actionLabel='Перейти к голосованию';
   actionKind='primary';
   actionDisabled=false;
   actionHandler=()=>openVoting(vote.id);
  }else if(n.status==='approved'&&canPresident&&n.office_kind!=='central_bank_chair'){
   actionLabel='Назначить';
   actionKind='primary';
   actionDisabled=false;
   actionHandler=()=>void appoint(n.id);
  }else if(n.status==='rejected'&&rejects>=3&&latest(n.office_key)?.id===n.id&&canPresident&&n.office_kind!=='central_bank_chair'){
   actionLabel='Назначить после 3 отклонений';
   actionKind='primary';
   actionDisabled=false;
   actionHandler=()=>void appointAfterThree(n.id);
  }else if(n.status==='appointed'){
   actionLabel='Назначено';
  }else if(n.status==='rejected'){
   actionLabel='Отклонено';
  }else if(n.status==='approved'){
   actionLabel='Утверждено';
  }else if(vote?.status==='closed'){
   actionLabel=vote.result_label||STATUS[n.status];
  }

  return <article className={'gov8AgendaRow is-'+n.status}>
   <span className="gov8AgendaIndex">{String(index+1).padStart(2,'0')}</span>
   <div className="gov8AgendaMain">
    <small>{n.office_title}</small>
    <div className="gov8AgendaNameRow"><b>{n.candidate_name}</b>{teacher&&n.status!=='appointed'&&<button className="gov8RemoveNomination" title="Снять кандидатуру" aria-label={'Снять кандидатуру '+n.candidate_name} disabled={!!busy} onClick={()=>void withdrawNomination(n.id,n.candidate_name)}><Trash2 size={15}/></button>}</div>
    <span>Попытка {n.attempt_no}/3 · {STATUS[n.status]}{rejects?' · отклонений: '+rejects:''}</span>
   </div>
   <div className="gov8AgendaActions">
    <div className="gov8AgendaLinks">
     <button className="gov8LinkButton" disabled={!n.formal_document_id} onClick={()=>n.formal_document_id&&onOpenDocument?.(n.formal_document_id)}>Документ</button>
     <button className="gov8LinkButton" disabled={!n.formal_document_id} onClick={()=>n.formal_document_id&&onNavigate?.('documents')}>Реестр НПА</button>
     <button className="gov8LinkButton" disabled={!n.vote_id} onClick={()=>n.vote_id&&openVoting(n.vote_id)}>Голосование</button>
     <button className="gov8LinkButton" onClick={()=>onNavigate?.('actions')}>Политический процесс</button>
    </div>
    <button
     className={actionKind+' gov8AgendaCta'}
     disabled={actionDisabled||!!busy}
     onClick={()=>actionHandler?.()}
    >{actionLabel}</button>
   </div>
  </article>;
 }

 return <section className="gov8Workspace">
  <header className="gov8Overview">
   <div className="gov8OverviewCopy">
    <small>ЭТАП 8 · ФОРМИРОВАНИЕ ПРАВИТЕЛЬСТВА</small>
    <h2>От кандидатуры Председателя Правительства — к пяти министерствам</h2>
    <p>Один процедурный контур: кандидатуры попадают прямо в повестку Государственной Думы, решения ГД меняют статус назначения, а после назначения Председателя Правительства открывается структура из пяти министерств.</p>
   </div>
   <div className="gov8NextAction"><small>СЛЕДУЮЩЕЕ ДЕЙСТВИЕ</small><b>{nextAction}</b><span>Фаза {phase} из 4</span></div>
  </header>

  <div className="gov8Progress" aria-label="Этапы формирования Правительства">
   {[
    ['01','Председатель Правительства','Кандидатура → ГД → назначение'],
    ['02','Структура','Ровно пять министерств'],
    ['03','Состав','3 через ГД · 2 через СФ'],
    ['04','Правительство','Состав сформирован']
   ].map((x,i)=><div key={x[0]} className={'gov8ProgressStep is-'+stepState(i+1)}><span>{x[0]}</span><div><b>{x[1]}</b><small>{x[2]}</small></div>{i+1<4&&<ArrowRight size={16}/>}</div>)}
  </div>

  <section className="gov8Duma">
   <header className="gov8SectionHead">
    <div><span className="gov8SectionIcon"><Landmark size={20}/></span><div><small>ГОСУДАРСТВЕННАЯ ДУМА</small><h3>Заседание по формированию Правительства</h3><p>Кандидатуры находятся здесь же — в повестке. Никакого отдельного «конструктора» ниже.</p></div></div>
    <div className="gov8SessionFacts"><span><b>{registrations.length}</b> зарегистрировано</span><span><b>{dumaRows.length}</b> вопросов</span><span><b>{openDumaVotes.length}</b> открыто</span></div>
   </header>

   <div className="gov8Procedure">
    <button onClick={()=>setRegistrationOpen(v=>!v)} className={registrations.some(x=>x.user_id===me.user_id)?'isDone':'isCurrent'}><span>01</span><ClipboardCheck size={18}/><div><small>ПРИСУТСТВИЕ</small><b>Регистрация</b><em>{registrations.some(x=>x.user_id===me.user_id)?'Вы зарегистрированы':'Развернуть регистрацию ГД'}</em></div></button>
    <button disabled={!publicChannel} onClick={openChat}><span>02</span><MessageCircle size={18}/><div><small>ОБСУЖДЕНИЕ</small><b>Публичный чат</b><em>{publicChannel?'Обсудить кандидатуры':'Нет публичного канала'}</em></div></button>
    <button onClick={()=>document.getElementById('gov8-agenda')?.scrollIntoView({behavior:'smooth',block:'center'})}><span>03</span><UsersRound size={18}/><div><small>ПОВЕСТКА</small><b>Кандидатуры</b><em>{dumaRows.length?dumaRows.length+' вопросов':'Сформируйте первый вопрос'}</em></div></button>
    <button disabled={!activeVoteId} onClick={()=>openVoting(activeVoteId)} className={openDumaVotes.length?'isLive':''}><span>04</span><Vote size={18}/><div><small>РЕШЕНИЕ</small><b>Голосование</b><em>{openDumaVotes.length?'Открыто: '+openDumaVotes.length:'Ожидает открытия'}</em></div></button>
   </div>

   {registrationOpen&&<div className="gov8InlineRegistration"><InstitutionRegistrationPanel g={g} stageNo={8} initialBody="gd" allowedBodies={['gd']} defaultOpen/></div>}

   <div id="gov8-agenda" className="gov8Agenda">
    <div className="gov8AgendaTitle"><div><small>ПОВЕСТКА</small><h4>Вопросы заседания</h4></div><span>{dumaRows.filter(x=>['approved','rejected','appointed'].includes(x.status)).length}/{dumaRows.length} рассмотрено</span></div>

    {!pm||pm.status==='rejected'?<article className="gov8SubmissionCard isPrimary">
     <div className="gov8SubmissionIntro"><span><UserRoundPlus size={19}/></span><div><small>ВОПРОС 1</small><b>Председатель Правительства Российской Федерации</b><p>Президент вносит кандидатуру. После внесения преподаватель открывает связанное голосование ГД.</p></div></div>
     {canPresident?<><NomineeFields slot="prime_minister" students={students} selectedUserId={selected.prime_minister||''} value={manual.prime_minister||''} onSelect={handleNomineeSelect} onNameChange={handleNomineeNameChange}/><button className="primary" disabled={!!busy||candidateName('prime_minister').length<3||rejections('prime_minister')>=3} onClick={()=>void submitNomination('prime_minister','prime_minister','Председатель Правительства Российской Федерации','prime_minister')}>Внести кандидатуру в повестку</button></>:<div className="gov8LockedHint">Ожидается действие Президента Российской Федерации.</div>}
    </article>:null}

    {!cbr||cbr.status==='rejected'?<article className="gov8SubmissionCard">
     <div className="gov8SubmissionIntro"><span><Building2 size={19}/></span><div><small>ВОПРОС 2</small><b>Председатель Банка России</b><p>Отдельный вопрос той же повестки. Положительное голосование ГД является назначением.</p></div></div>
     {canPresident?<><NomineeFields slot="central_bank_chair" students={students} selectedUserId={selected.central_bank_chair||''} value={manual.central_bank_chair||''} onSelect={handleNomineeSelect} onNameChange={handleNomineeNameChange}/><button className="secondary" disabled={!!busy||candidateName('central_bank_chair').length<3} onClick={()=>void submitNomination('central_bank_chair','central_bank_chair','Председатель Центрального банка Российской Федерации','central_bank_chair')}>Внести кандидатуру</button></>:<div className="gov8LockedHint">Ожидается действие Президента Российской Федерации.</div>}
    </article>:null}

    {dumaRows.length>0&&<div className="gov8AgendaList">{dumaRows.map((n,i)=><AgendaRow key={n.id} n={n} index={i}/>)}</div>}

    {rejections('prime_minister')>=3&&<div className="gov8ConstitutionAlert"><ShieldCheck size={20}/><div><b>Три отклонения кандидатуры Председателя Правительства</b><p>По правилам игры активируется конституционная развилка: Президент назначает Председателя Правительства и получает право распустить Государственную Думу и назначить новые выборы.</p></div>{onOpenStage&&<button className="secondary" onClick={()=>onOpenStage(2)}>К выборам ГД</button>}</div>}
   </div>
  </section>

  <section className={'gov8Ministries '+(!pmAppointed?'isLocked':'')}>
   <header className="gov8SectionHead">
    <div><span className="gov8SectionIcon"><Building2 size={20}/></span><div><small>СТРУКТУРА ПРАВИТЕЛЬСТВА</small><h3>Пять министерств</h3><p>Функции фиксированы правилами игры. После назначения Председатель Правительства может уточнить только названия; Президент одобряет структуру или возвращает её на переименование.</p></div></div>
    <span className={'gov8StatusPill is-'+(structure?.status||'preview')}>{!pmAppointed?'Предпросмотр':structure?.status==='approved'?'Одобрено':structure?.status==='submitted'?'На рассмотрении':structure?.status==='revision'?'На доработке':'Черновик'}</span>
   </header>

   {!pmAppointed&&<div className="gov8PreviewNotice"><span>Предпросмотр</span><p>Все пять министерств и кадровые поля показаны ниже. Они активируются последовательно после назначения Председателя Правительства и утверждения структуры.</p></div>}

   {structure?.note&&<div className="gov8RevisionNote"><b>Замечание Президента</b><p>{structure.note}</p></div>}
    <div className="gov8MinistryGrid">
     {PORTFOLIOS.map((p,index)=>{
      const nomination=latest('ministry_'+p.key);
      const editable=pmAppointed&&canPM&&(!structure||structure.status==='draft'||structure.status==='revision');
      const isDeputy=p.route==='duma'&&deputyPortfolio===p.key;
      const canNominate=p.route==='duma'?canPM:canPresident;
      const officeKind:Nomination['office_kind']=p.route==='sf'?'security_minister':isDeputy?'deputy_pm':'duma_minister';
      const officeTitle=isDeputy?'Заместитель Председателя Правительства РФ — '+titles[p.key]:titles[p.key];
      const slot='ministry_'+p.key;
      return <article key={p.key} className={'gov8MinistryCard route-'+p.route+' '+(nomination?'hasNomination':'')}>
       <header><span>{String(index+1).padStart(2,'0')}</span><div><small>{p.label}</small><b>{titles[p.key]}</b></div><em>{p.route==='duma'?'Государственная Дума':'Совет Федерации'}</em></header>
       <p>{p.scope}</p>
       <label className="gov8MinistryTitle">Название<input disabled={!editable} value={titles[p.key]} onChange={e=>{structureDirty.current=true;setTitles(v=>({...v,[p.key]:e.target.value}))}}/></label>

       {p.route==='duma'&&!activeDeputy&&<label className={'gov8DeputyChoice '+(!structureApproved?'isDisabled':'')}><input type="radio" name="gov8-deputy" disabled={!structureApproved} checked={deputyPortfolio===p.key} onChange={()=>setDeputyPortfolio(p.key)}/><span>Этот министр одновременно является заместителем Председателя Правительства</span></label>}
       {activeDeputy?.office_key===slot&&<div className="gov8DeputyFlag">Заместитель Председателя Правительства</div>}

       {nomination&&!['rejected','withdrawn'].includes(nomination.status)?<div className="gov8MinistryNominee"><small>КАНДИДАТУРА</small><b>{nomination.candidate_name}</b><span>{STATUS[nomination.status]} · попытка {nomination.attempt_no}/3</span>
        <div className="gov8MinistryLinks">
         {nomination.formal_document_id&&<button onClick={()=>onOpenDocument?.(nomination.formal_document_id!)}>Постановление ГД</button>}
         {nomination.appointment_document_id&&<button onClick={()=>onOpenDocument?.(nomination.appointment_document_id!)}>Указ Президента</button>}
         {nomination.vote_id&&<button onClick={()=>openVoting(nomination.vote_id)}>Голосование</button>}
        </div>
        {nomination.status==='consultation_pending'&&teacher&&<div className="gov8Consult"><textarea rows={2} value={consultNotes[nomination.id]||''} onChange={e=>setConsultNotes(v=>({...v,[nomination.id]:e.target.value}))} placeholder="Итог консультации с Советом Федерации"/><button className="secondary" disabled={!!busy} onClick={()=>void consult(nomination.id)}>Зафиксировать консультацию</button></div>}
        {nomination.status==='consulted'&&canPresident&&<button className="primary" disabled={!!busy} onClick={()=>void appoint(nomination.id)}>Назначить министром</button>}
        {nomination.status==='approved'&&canPresident&&<button className="primary" disabled={!!busy} onClick={()=>void appoint(nomination.id)}>Назначить после решения ГД</button>}
        {nomination.status==='rejected'&&rejections(slot)>=3&&canPresident&&p.route==='duma'&&<button className="primary" disabled={!!busy} onClick={()=>void appointAfterThree(nomination.id)}>Назначить после 3 отклонений</button>}
        {nomination.vote_id&&votes.find(v=>v.id===nomination.vote_id)?.status==='open'&&<button className="secondary" onClick={()=>openVoting(nomination.vote_id)}>Регистрация и голосование</button>}
       </div>:<div className={'gov8MinistryNomination '+(!structureApproved||!canNominate?'isPreview':'')}><NomineeFields slot={slot} disabled={!structureApproved||!canNominate} students={students} selectedUserId={selected[slot]||''} value={manual[slot]||''} onSelect={handleNomineeSelect} onNameChange={handleNomineeNameChange}/><button className="secondary" disabled={!structureApproved||!canNominate||rejections(slot)>=3||!!busy||candidateName(slot).length<3} onClick={()=>void submitNomination(slot,slot,officeTitle,officeKind)}>{nomination?.status==='rejected'?'Внести новую кандидатуру':'Внести кандидатуру'}</button><small className="gov8FormGate">{!structureApproved?(!pmAppointed?'Активируется после назначения Председателя Правительства и утверждения структуры':'Активируется после утверждения структуры Президентом'):!canNominate?(p.route==='duma'?'Кандидатуру вносит Председатель Правительства':'Кандидатуру вносит Президент'):rejections(slot)>=3?'После трёх отклонений используется специальное назначение по правилам этапа':'Можно внести кандидатуру'}</small></div>}
      </article>
     })}
    </div>

    {canPM&&(!structure||structure.status==='draft'||structure.status==='revision')&&<div className="gov8StructureActions"><button className="secondary" disabled={!pmAppointed||!!busy} onClick={()=>void saveStructure(false)}>Сохранить названия</button><button className="primary" disabled={!pmAppointed||!!busy} onClick={()=>void saveStructure(true)}>Представить структуру Президенту</button></div>}
    {structure?.formal_document_id&&<div className="gov8StructureDocument"><span>Структура оформлена указом Президента</span><button className="secondary" onClick={()=>onOpenDocument?.(structure.formal_document_id!)}>Открыть указ</button></div>}
    {canPresident&&structure?.status==='submitted'&&<div className="gov8PresidentReview"><label>Комментарий Президента<textarea rows={2} value={structureNote} onChange={e=>setStructureNote(e.target.value)} placeholder="Комментарий при возврате на переименование"/></label><div><button className="secondary" disabled={!!busy} onClick={()=>void reviewStructure('revision')}><X size={16}/> Вернуть на переименование</button><button className="primary" disabled={!!busy} onClick={()=>void reviewStructure('approve')}><Check size={16}/> Одобрить пять министерств</button></div></div>}
  </section>

  <section className="gov8RulesStrip">
   <div><small>ЛОГИКА ПРАВИЛ</small><b>1 заместитель + 4 министра = 5 руководителей министерств</b></div>
   <span>3 портфеля: Председатель Правительства → ГД → Президент</span>
   <span>2 специальных портфеля: Президент → консультация СФ → назначение</span>
   <span>СФ в игровой модели консультирует преподаватель</span>
  </section>
 </section>;
}
