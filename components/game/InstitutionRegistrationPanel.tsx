'use client';
import {userError} from '@/lib/userError';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {isStageWorkOpen} from './stageWorkStatus';
import type {ReturnTypeRepublic} from './viewTypes';
import StyledSelect from '../ui/StyledSelect';
import {VOTING_BODIES,bodyQuorum,type VotingUnit} from './votingBodies';
import {ClipboardCheck} from 'lucide-react';
import DisclosureSummary from '../ui/DisclosureSummary';
type Entry={user_id:string;institution_key:string;stage_no:number;present_mandates:number|null};
type GdPresence={user_id:string;capacity:number;declared:number|null;present:number};
type Assignment={unit_id:string;user_id:string};
type Office={user_id:string;role_title:string};
type MeetingRecord={game_id:string;stage_no:number;institution_key:string;agenda_document_id:string|null;agenda_body:string|null;agenda_approved_at:string|null;minutes_document_id:string|null;minutes_body:string|null;minutes_approved_at:string|null;delegate_user_id:string|null};
type MeetingPermissions={can_coordinate:boolean;can_prepare:boolean;can_attend:boolean};
function meetingErrorMessage(message:string):string{
 if(/Этап завершён|ещё не открыт|stage.*closed/i.test(message))return 'Этап завершён или ещё не открыт. Изменение документов разрешено только во время открытого этапа.';
 if(/permission denied|недостаточно прав|42501|403/i.test(message))return 'Нет полномочий для этого действия. Повестку утверждает председатель или преподаватель; подготовку может выполнить назначенный участник.';
 return message.length<=250?message:'Не удалось выполнить действие. Обновите данные заседания и повторите попытку.';
}
export default function InstitutionRegistrationPanel({g,readOnly=false,onUnitsChange,stageNo,initialBody,allowedBodies,defaultOpen=false,onOpenDocument,onMeetingReadyChange}:{g:ReturnTypeRepublic;readOnly?:boolean;onUnitsChange?:(units:VotingUnit[])=>void;stageNo?:number;initialBody?:string;allowedBodies?:string[];defaultOpen?:boolean;onOpenDocument?:(id:string)=>void;onMeetingReadyChange?:(ready:boolean)=>void}){
 const [rows,setRows]=useState<Entry[]>([]),[units,setUnits]=useState<VotingUnit[]>([]),[assignments,setAssignments]=useState<Assignment[]>([]),[offices,setOffices]=useState<Office[]>([]);
 const [body,setBody]=useState(initialBody||'gd'),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[newTitle,setNewTitle]=useState(''),[users,setUsers]=useState<string[]>([]),[head,setHead]=useState('');
 const [seats,setSeats]=useState('1'),[editing,setEditing]=useState<string|null>(null);
 const [meetingRows,setMeetingRows]=useState<MeetingRecord[]>([]);
 const [agendaText,setAgendaText]=useState(''),[minutesText,setMinutesText]=useState(''),[delegateUser,setDelegateUser]=useState('');
 const [meetingError,setMeetingError]=useState('');
 const [permission,setPermission]=useState<{key:string;rights:MeetingPermissions}|null>(null);
 const [rightsVersion,setRightsVersion]=useState(0);
 const [gdPresence,setGdPresence]=useState<{my_capacity:number;registered:GdPresence[]}|null>(null);
 const [presenceDraft,setPresenceDraft]=useState('');
 const [agendaEditorOpen,setAgendaEditorOpen]=useState(false);
 const [stage12Session,setStage12Session]=useState<{id:string;status:string}|null>(null);
 const [stage12Text,setStage12Text]=useState('');
 const [stage12InitialText,setStage12InitialText]=useState('');
 const [stage12Reason,setStage12Reason]=useState('');
 const [stage12Saving,setStage12Saving]=useState(false);
 async function loadStage12Editor(){
  if(!g.game)return;
  setMeetingError('');
  const s=await supabase.from('duma_sessions').select('id,status,agenda_document_id')
   .eq('game_id',g.game.id).eq('stage_no',12)
   .order('session_no',{ascending:false}).limit(1).maybeSingle();
  if(s.error){setMeetingError(meetingErrorMessage(userError(s.error)));return;}
  if(!s.data?.agenda_document_id){setStage12Session(null);return;}
  const doc=await supabase.from('formal_documents').select('body_text')
   .eq('game_id',g.game.id).eq('id',s.data.agenda_document_id).maybeSingle();
  if(doc.error){setMeetingError(meetingErrorMessage(userError(doc.error)));return;}
  if(!doc.data)return;
  setStage12Session({id:s.data.id,status:s.data.status});
  setStage12InitialText(doc.data.body_text||'');
  setStage12Text(doc.data.body_text||'');
 }
 async function saveStage12Editor(){
  if(!g.game||!stage12Session||!verifiedRights?.can_coordinate||readOnly||stage12Saving
   ||stage12Text.trim().length<80||stage12Text.length>20000
   ||stage12Text.trim()===stage12InitialText.trim())return;
  if(stage12Session.status==='open'&&stage12Reason.trim().length<10)return;
  setStage12Saving(true);setMeetingError('');
  const result=await supabase.rpc('edit_stage12_duma_agenda_text',{
   p_session_id:stage12Session.id,p_body:stage12Text,
   p_expected_body:stage12InitialText,
   p_reason:stage12Session.status==='open'?stage12Reason.trim():null
  });
  if(result.error){setMeetingError(meetingErrorMessage(userError(result.error)));}
  else{
   setAgendaEditorOpen(false);setStage12Reason('');
   setNotice('Текст повестки обновлён в едином документе НПА.');
   await load();
  }
  setStage12Saving(false);
 }
 const detailsRef=useRef<HTMLDetailsElement>(null);
 const lastMeetingDraftRef=useRef<{scope:string;agenda:string;minutes:string;delegate:string}|null>(null);
 const stage=stageNo||g.game?.current_round||1,students=g.members.filter(m=>m.kind==='student');
 async function load(){if(!g.game)return;const [r,u,a,b,o,meeting]=await Promise.all([supabase.from('institution_session_registrations').select('user_id,institution_key,stage_no,present_mandates').eq('game_id',g.game.id).eq('stage_no',stage),supabase.from('institution_units').select('id,title,unit_kind,head_user_id,unit_key,mandate_capacity').eq('game_id',g.game.id),supabase.from('institution_assignments').select('unit_id,user_id').eq('game_id',g.game.id),supabase.from('game_voting_body_members').select('unit_id,user_id').eq('game_id',g.game.id),supabase.from('game_office_assignments').select('user_id,role_title').eq('game_id',g.game.id).eq('status','active'),
  supabase.from('institution_meeting_records').select('game_id,stage_no,institution_key,agenda_document_id,agenda_body,agenda_approved_at,minutes_document_id,minutes_body,minutes_approved_at,delegate_user_id').eq('game_id',g.game.id).eq('stage_no',stage)]);
  const failure=[r,u,a,b,o,meeting].find(x=>x.error);if(failure?.error){setMeetingError('Не удалось загрузить сведения о заседании. '+meetingErrorMessage(userError(failure.error)));return;}
  if(!r.error)setRows(r.data||[]);if(!u.error){setUnits(u.data||[]);onUnitsChange?.(u.data||[])}setAssignments([...(a.data||[]),...(b.data||[])]);if(!o.error)setOffices(o.data||[]);if(!meeting.error)setMeetingRows((meeting.data||[]) as MeetingRecord[]);setRightsVersion(v=>v+1);
 }
 useEffect(()=>{if(initialBody)setBody(initialBody)},[initialBody]);
 useEffect(()=>{if(defaultOpen&&detailsRef.current)detailsRef.current.open=true},[defaultOpen,stage,initialBody]);
 useGameTableSync(g.game?.id,['institution_session_registrations','institution_units','institution_assignments','game_voting_body_members','game_office_assignments','institution_meeting_records','formal_documents','office_elections','office_candidates','party_member_mandates','game_members'],load,String(stage));
 useEffect(()=>{
  if(body!=='gd'||!g.game){setGdPresence(null);return}
  let active=true;
  void Promise.resolve(supabase.rpc('get_gd_session_attendance',{p_game_id:g.game.id,p_stage_no:stage}))
   .then(({data,error})=>{
    if(!active)return;
    if(error){setMeetingError('Не удалось получить сведения о явке депутатов. '+meetingErrorMessage(userError(error)));return}
    const state=data as {my_capacity:number;registered:GdPresence[]};
    if(!state||!Array.isArray(state.registered)){setMeetingError('Сведения о депутатской явке недоступны.');return}
    setGdPresence(state);
    const mine=state.registered.find(row=>row.user_id===g.me?.user_id);
    setPresenceDraft(mine?.declared==null?String(state.my_capacity):String(mine.declared));
   }).catch(()=>{if(active)setMeetingError('Не удалось загрузить данные о явке депутатов.')});
  return()=>{active=false};
 },[g.game?.id,g.me?.user_id,stage,body,rightsVersion]);
 // Refresh only when the persisted meeting document or selected scope really changes.
 // Unrelated table subscriptions must not overwrite a participant's unsaved draft.
 useEffect(()=>{
  const row=meetingRows.find(m=>m.institution_key===body);
  const snapshot={scope:[g.game?.id||'',stage,body].join(':'),agenda:row?.agenda_body||'',minutes:row?.minutes_body||'',delegate:row?.delegate_user_id||''};
  const previous=lastMeetingDraftRef.current;
  if(previous?.scope!==snapshot.scope||previous.agenda!==snapshot.agenda)setAgendaText(snapshot.agenda);
  if(previous?.scope!==snapshot.scope||previous.minutes!==snapshot.minutes)setMinutesText(snapshot.minutes);
  if(previous?.scope!==snapshot.scope||previous.delegate!==snapshot.delegate)setDelegateUser(snapshot.delegate);
  lastMeetingDraftRef.current=snapshot;
 },[meetingRows,body,g.game?.id,stage]);
 const permissionKey=[g.game?.id,g.me?.user_id,stage,body].join(':');
 const currentDelegate=meetingRows.find(m=>m.institution_key===body)?.delegate_user_id;
 useEffect(()=>{
  if(!g.game||!g.me)return;
  let active=true;
  setPermission(null);
  setMeetingError('');
  void Promise.resolve(supabase.rpc('get_my_institution_meeting_permissions',{p_game_id:g.game.id,p_stage_no:stage,p_institution:body}))
   .then(({data,error})=>{
    if(!active)return;
    if(error){setMeetingError('Не удалось проверить полномочия. '+meetingErrorMessage(userError(error)));return;}
    if(!data||typeof data.can_coordinate!=='boolean'||typeof data.can_prepare!=='boolean'||typeof data.can_attend!=='boolean'){
     setMeetingError('Сервер не подтвердил полномочия для этого заседания. Повторите попытку после обновления страницы.');return;
    }
    setPermission({key:permissionKey,rights:{can_coordinate:data.can_coordinate,can_prepare:data.can_prepare,can_attend:data.can_attend}});
   }).catch(()=>{if(active)setMeetingError('Не удалось проверить полномочия. Проверьте соединение и повторите попытку.')});
  return()=>{active=false};
 },[permissionKey,currentDelegate,rightsVersion]);
 useEffect(()=>{
  if(body!=='ksrf'||(stage!==2&&stage!==3))return;
  const ready=!!meetingRows.find(m=>m.institution_key==='ksrf')?.agenda_approved_at
    &&rows.some(r=>r.institution_key==='ksrf'&&r.user_id===g.me?.user_id);
  onMeetingReadyChange?.(ready);
 },[body,stage,rows,meetingRows,g.me?.user_id,onMeetingReadyChange]);
 if(!g.game||!g.me)return null;
 const availableBodies=VOTING_BODIES.filter(item=>!allowedBodies||allowedBodies.includes(item.key));
 const config=VOTING_BODIES.find(b=>b.key===body),unit=units.find(u=>'unit:'+u.id===body);
 function eligible(uid:string){const m=g.members.find(x=>x.user_id===uid);if(!m||m.kind==='observer')return false;if(unit)return assignments.some(a=>a.unit_id===unit.id&&a.user_id===uid);if(body==='ksrf')return m.kind==='student'||g.parties.some(p=>p.leader_user_id===uid);if(body==='gd'&&m.kind==='student')return !m.roster_archived_at;return !!config&&(config.role.test(m.role_title||'')||(m.kind==='student'&&offices.some(o=>o.user_id===uid&&config.role.test(o.role_title))))}
 const participants=g.members.filter(m=>eligible(m.user_id));
 const registered=rows.filter(r=>r.institution_key===body&&participants.some(m=>m.user_id===r.user_id));
 const mine=rows.some(r=>r.institution_key===body&&r.user_id===g.me?.user_id);
 const factionCount=body==='ksrf'?g.parties.length:0;
 const total=body==='ksrf'?factionCount:body==='gd'?450:body==='government'?participants.length:body==='municipality'?participants.length:unit?.mandate_capacity??participants.length;
 const present=body==='ksrf'?new Set(registered.map(r=>g.parties.find(p=>p.leader_user_id===r.user_id)?.id).filter(Boolean)).size:body==='gd'?registered.reduce((n,r)=>n+(gdPresence?.registered.find(x=>x.user_id===r.user_id)?.present||0),0):registered.length;
 const needed=bodyQuorum(body,total);
 const meetingRecord=meetingRows.find(m=>m.institution_key===body);
 const gdStage12CanonicalAgenda=body==='gd'&&stage===12;
 const agendaReady=!!meetingRecord?.agenda_approved_at;
 const verifiedRights=permission?.key===permissionKey?permission.rights:null;
 // Align VotesView with the existing stage guard used by StageWorkspace and
 // private.guard_stage_submission. A coordinator role alone cannot reopen a stage.
 const stageReadOnly=!g.teacher&&!isStageWorkOpen(g.game,g.stages.find(item=>item.stage_no===stage));
 // The meeting is a prerequisite to work in KSRF stages 2 and 3.
 // Its setup remains available, while regular stage actions stay locked.
 const preStageKsrf=body==='ksrf'&&(stage===2||stage===3);
 const meetingActionsLocked=stageReadOnly&&!preStageKsrf;
 const meetingCoordinator=!!verifiedRights?.can_coordinate&&!meetingActionsLocked;
 const canPrepare=!!verifiedRights?.can_prepare&&!meetingActionsLocked;
 const canAttend=!!verifiedRights?.can_attend&&!meetingActionsLocked;
 const agendaHasDocument=!!meetingRecord?.agenda_document_id;
 const agendaTextLength=agendaText.trim().length;
 const agendaDraft=agendaHasDocument&&!agendaReady;
 // Earlier game versions permitted attendance before the first agenda existed.
 // Never offer a second edit once anyone has registered.
 const hasSessionRegistrations=rows.some(r=>r.institution_key===body);
 const canWriteAgenda=!gdStage12CanonicalAgenda&&(!agendaHasDocument||!hasSessionRegistrations);
 const canApproveAgenda=meetingCoordinator&&agendaDraft&&(meetingRecord?.agenda_body?.trim().length||0)>=30;
 async function saveMeetingDocument(kind:'agenda'|'minutes'){
  if(!g.game||busy||!canPrepare||readOnly||meetingActionsLocked||(kind==='agenda'&&!canWriteAgenda))return;
  setMeetingError('');setNotice('');setBusy(true);
  const r=await supabase.rpc('save_institution_meeting_document',{p_game_id:g.game.id,p_stage_no:stage,p_institution:body,p_kind:kind,p_body:kind==='agenda'?agendaText:minutesText});
  if(r.error)setMeetingError(meetingErrorMessage(userError(r.error)));else{await load();setNotice(kind==='agenda'?(meetingCoordinator?'Повестка сохранена в реестре НПА и утверждена.':'Проект повестки сохранён. Ожидается утверждение председателем.'):'Протокол сохранён в реестре НПА.')}
  setBusy(false);
 }
 async function approveMeeting(kind:'agenda'|'minutes'){
  if(!g.game||busy||!meetingCoordinator||readOnly||meetingActionsLocked)return;setMeetingError('');setNotice('');setBusy(true);
  const r=await supabase.rpc(kind==='agenda'?'approve_institution_meeting_agenda':'approve_institution_meeting_minutes',{p_game_id:g.game.id,p_stage_no:stage,p_institution:body});
  if(r.error)setMeetingError(meetingErrorMessage(userError(r.error)));else{await load();setNotice(kind==='agenda'?'Повестка утверждена. Регистрация доступна.':'Протокол утверждён.')}
  setBusy(false);
 }
 async function assignMeetingDelegate(){
  if(!g.game||!meetingCoordinator||readOnly||meetingActionsLocked||busy)return;setMeetingError('');setNotice('');setBusy(true);
  const r=await supabase.rpc('assign_institution_meeting_secretary',{p_game_id:g.game.id,p_stage_no:stage,p_institution:body,p_delegate:delegateUser||null});
  if(r.error)setMeetingError(meetingErrorMessage(userError(r.error)));else{await load();setNotice('Ответственный исполнитель сохранён.')}
  setBusy(false);
 }
 async function register(){if(!g.game||!canAttend||!agendaReady||readOnly||meetingActionsLocked||busy)return;setMeetingError('');setNotice('');setBusy(true);const r=await supabase.rpc('register_institution_session_at_stage',{p_game_id:g.game.id,p_institution:body,p_stage_no:stage});if(r.error)setMeetingError(meetingErrorMessage(userError(r.error)));else{await load();setNotice('Вы зарегистрированы на заседание.')}setBusy(false)}
 async function saveGdPresence(){
  if(!g.game||busy||readOnly||meetingActionsLocked||!agendaReady||!canAttend||!gdPresence)return;
  const number=Number(presenceDraft),capacity=Number(gdPresence.my_capacity||0);
  if(presenceDraft.trim()===''||!Number.isInteger(number)||number<0||number>capacity){
   setMeetingError('Укажите целое количество присутствующих депутатов от 0 до '+capacity+'.');return;
  }
  setBusy(true);setMeetingError('');setNotice('');
  const {error}=await supabase.rpc('set_gd_session_attendance',{
   p_game_id:g.game.id,p_stage_no:stage,p_present:number
  });
  if(error)setMeetingError(meetingErrorMessage(error.message));
  else{await load();setNotice('Явка депутатов сохранена. Кворум пересчитан.')}
  setBusy(false);
 }
 async function createBody(){if(!g.game)return;setBusy(true);const r=await supabase.rpc('save_civic_voting_body',{p_game_id:g.game.id,p_title:newTitle.trim(),p_seats:Number(seats),p_users:users,p_head:head||null,p_unit:editing});if(r.error)g.setError(userError(r.error));else{await load();setBody('unit:'+r.data);setNewTitle('');setUsers([]);setHead('');setSeats('1');setEditing(null);setNotice('Состав органа сохранён. Его можно выбрать при открытии голосования.')}setBusy(false)}
 return <details ref={detailsRef} className="institutionRegistrationPanel civicRegistration civicDisclosure projectDisclosure" aria-label="Регистрация на заседания"><DisclosureSummary icon={ClipboardCheck} title="Регистрация на заседание" description={'Этап '+stage+' · Регистрация в органе власти'}/><div className="civicDisclosureBody"><p>{body==='ksrf'?'До внесения предложений и голосования необходимо зарегистрироваться на заседание КСРФ. Участвовать могут все участники, но один голос от фракции подаёт её избранный представитель.':body==='gd'&&stage===4?'До формирования руководства Государственной Думы повестку готовят председатели зарегистрированных политических партий. После избрания Председателя Думы и формирования Совета Думы полномочия переходят руководству палаты. Для участия в заседании после утверждения повестки необходима регистрация.':'Перед участием в заседании и голосовании необходимо зарегистрироваться в соответствующем органе после утверждения повестки.'}</p>
  <div className="civicRegistrationSelectors"><StyledSelect label="Орган" value={body} onChange={setBody} options={[...availableBodies.map(b=>({value:b.key,label:b.title})),...units.filter(u=>!allowedBodies||allowedBodies.includes('unit:'+u.id)).map(u=>({value:'unit:'+u.id,label:u.title}))]}/></div>
  <section className="civicMeetingDocuments" aria-label="Документы заседания" data-agenda-state={agendaReady?'approved':agendaDraft?'draft':'pending'}>
   <header><div><b>Повестка заседания</b><small>{agendaReady?'Утверждена · регистрация разрешена':agendaDraft?(gdStage12CanonicalAgenda?'Автоматически сформирована · требуется утверждение':'Проект в реестре · требуется утверждение'):verifiedRights&&!canAttend?'Повестка доступна уполномоченным участникам':'Повестка ещё не составлена'}</small></div><span>{agendaHasDocument?'В реестре НПА':'Не оформлена'}</span></header>
   <div className="civicMeetingSteps" aria-label="Порядок заседания">
    <span><b>1. Подготовка</b>{body==='gd'&&stage===4?'Руководители партий, затем руководство Думы':'Председатель или назначенный исполнитель'}</span>
    <span><b>2. Утверждение</b>{body==='gd'&&stage===4?'Председатель партии, затем руководство Думы':'Председатель или преподаватель'}</span>
    <span><b>3. Регистрация</b>Участники соответствующего органа</span>
   </div>
   <p className="civicMeetingHelp" role="status">{readOnly?'Режим просмотра. Подготовка и регистрация недоступны.':meetingActionsLocked?'Этап закрыт. Изменения и регистрация недоступны.':gdStage12CanonicalAgenda?'Повестка автоматически составляется из пакетов законопроектов в разделе «Работа». До открытия заседания она пополняется автоматически. Председатель утверждает подготовленный документ; после открытия изменения вносит только через обоснованную корректировку заседания.':!verifiedRights?'Проверяем ваши полномочия для этого органа…':meetingCoordinator?'Вы можете составить и утвердить повестку или назначить исполнителя. Документ автоматически создаётся в реестре НПА, отдельно загружать его не нужно.':canPrepare?'Вам поручена подготовка проекта повестки. Сохраните проект, затем председатель утвердит его.':canAttend?'Вы можете зарегистрироваться после утверждения повестки, участвовать в заседании и голосовать в пределах своих полномочий. Подготовку повестки поручает председатель.':'У вас нет назначения в этот орган. Готовить повестку, утверждать её и регистрироваться на это заседание могут только уполномоченные участники.'}</p>
   {preStageKsrf&&stageReadOnly&&!readOnly&&<p className="civicMeetingHelp" role="status">Повестку и регистрацию можно оформить до открытия работы этапа. Для выполнения заданий завершённого этапа преподаватель должен повторно открыть его.</p>}
   {agendaHasDocument&&onOpenDocument&&<button type="button" className="secondary" onClick={()=>onOpenDocument(meetingRecord!.agenda_document_id!)}>Открыть повестку в реестре НПА</button>}
   {meetingError&&<p className="civicMeetingError" role="alert">{meetingError}</p>}
   {hasSessionRegistrations&&!agendaHasDocument&&<p className="civicMeetingHelp" role="status">Участники были зарегистрированы до оформления повестки. Можно подготовить её впервые: существующие регистрации и голоса сохранятся. После сохранения повестка станет недоступна для редактирования.</p>}
   {hasSessionRegistrations&&agendaHasDocument&&!agendaReady&&!gdStage12CanonicalAgenda&&<p className="civicMeetingHelp" role="status">Регистрация уже началась. Изменять подготовленный проект нельзя; председатель может только утвердить существующую повестку.</p>}
   {gdStage12CanonicalAgenda&&agendaHasDocument&&<section className="civicAgendaSyncedPreview" aria-label="Автоматически сформированная повестка Государственной Думы"><strong>Содержание повестки · Реестр НПА</strong><pre>{meetingRecord?.agenda_body||'Вопросы повестки загружаются…'}</pre></section>}
   {gdStage12CanonicalAgenda&&meetingCoordinator&&!readOnly&&agendaHasDocument&&<section className="civicAgendaEdit" aria-label="Корректировка повестки Государственной Думы">
    <button type="button" className="secondary" aria-expanded={agendaEditorOpen} onClick={()=>{setAgendaEditorOpen(v=>!v);if(!agendaEditorOpen)void loadStage12Editor();}}>Корректировать повестку</button>
    {agendaEditorOpen&&<div className="civicAgendaEditBody">
     <p>Измените непосредственно текст повестки заседания Государственной Думы. Состав законопроектов и голосования остаются прежними. Реестровые номера документов необходимо сохранить.</p>
     <label>Полный текст повестки
      <textarea className="civicAgendaTextEditor" rows={15} maxLength={20000}
       value={stage12Text} onChange={e=>setStage12Text(e.target.value)}
       placeholder="Текст повестки заседания Государственной Думы"/>
     </label>
     {stage12Session?.status==='open'&&<label>Основание корректировки после открытия
      <textarea rows={3} maxLength={500} value={stage12Reason}
       onChange={e=>setStage12Reason(e.target.value)}
       placeholder="Укажите основание решения председателя (от 10 символов)"/>
     </label>}
     <button type="button" className="primary"
      disabled={!stage12Session||stage12Saving||stage12Session.status==='closed'
       ||stage12Text.trim().length<80||stage12Text.length>20000
       ||stage12Text.trim()===stage12InitialText.trim()
       ||(stage12Session.status==='open'&&stage12Reason.trim().length<10)}
      onClick={()=>void saveStage12Editor()}>{stage12Saving?'Сохранение…':'Сохранить текст повестки'}</button>
    </div>}
   </section>}
   {canPrepare&&!readOnly&&!agendaReady&&canWriteAgenda&&<label>Содержание повестки<textarea aria-label="Текст повестки заседания" value={agendaText} rows={4} onChange={event=>setAgendaText(event.target.value)} placeholder="Вопросы заседания, порядок рассмотрения, выступающие и регламент"/></label>}
   {canPrepare&&!readOnly&&!agendaReady&&canWriteAgenda&&<div className="civicAgendaComposer"><small>{agendaTextLength<30?'Для сохранения укажите ещё '+(30-agendaTextLength)+' символов.':'Повестка готова к сохранению в реестре НПА.'}</small><button type="button" className={meetingCoordinator?'primary':'secondary'} disabled={busy||readOnly||agendaTextLength<30} onClick={()=>void saveMeetingDocument('agenda')}>{meetingCoordinator?'Сохранить и утвердить повестку':'Сохранить проект повестки в реестре НПА'}</button></div>}
   {canApproveAgenda&&!readOnly&&<button type="button" className="primary" disabled={busy||readOnly} onClick={()=>void approveMeeting('agenda')}>Утвердить подготовленный проект повестки</button>}
   {meetingCoordinator&&!readOnly&&<div className="civicMeetingDelegate"><StyledSelect label={gdStage12CanonicalAgenda?'Поручить оформление протокола':'Поручить заполнение повестки и протокола'} value={delegateUser} onChange={setDelegateUser} options={[{value:'',label:'Без поручения'},...participants.map(p=>({value:p.user_id,label:p.full_name||'Участник'}))]}/><button type="button" disabled={busy} onClick={()=>void assignMeetingDelegate()}>Сохранить поручение</button></div>}
   {registered.length>0&&<div className="civicMeetingMinutes"><header><b>Протокол по итогам заседания</b><span>{meetingRecord?.minutes_approved_at?'Утверждён':meetingRecord?.minutes_document_id?'Проект на утверждении':'Не составлен'}</span></header>
    {canPrepare&&!meetingRecord?.minutes_approved_at&&<><label>Содержание протокола<textarea aria-label="Текст протокола заседания" rows={5} value={minutesText} onChange={event=>setMinutesText(event.target.value)} placeholder="Присутствовали, кворум, вопросы, результаты голосований и постановления"/></label><button type="button" className="secondary" disabled={busy||minutesText.trim().length<30} onClick={()=>void saveMeetingDocument('minutes')}>Сохранить протокол как документ</button></>}
    {meetingCoordinator&&meetingRecord?.minutes_document_id&&!meetingRecord?.minutes_approved_at&&<button type="button" className="primary" disabled={busy} onClick={()=>void approveMeeting('minutes')}>Утвердить протокол</button>}
   </div>}
  </section>
  <div className="civicAttendance"><div><h3>{config?.title||unit?.title}</h3><p>{config?.basis||'Состав зарегистрированного в игре органа. Порог задаётся в голосовании.'}</p></div><div className="civicAttendanceNumbers"><span>Присутствует <b>{present} / {total}</b></span><span>Для кворума <b>{needed}</b></span><span>{present>=needed&&total>0?'Кворум есть':'Ожидаем участников'}</span></div><ul className="civicAttendees">{registered.map(r=>{const faction=body==='ksrf'?g.parties.find(p=>p.leader_user_id===r.user_id):null;const presence=gdPresence?.registered.find(x=>x.user_id===r.user_id);return <li key={r.user_id}>{body==='ksrf'?(faction?.name||'Участник КСРФ')+' · '+(g.names[r.user_id]||'Участник'):g.names[r.user_id]||'Участник'}<b>{body==='gd'?presence?(presence.present+' из '+presence.capacity+' депутатов'+(presence.declared==null?' · автоматически':'')):'Проверяем явку':body==='ksrf'?(faction?'1 голос фракции':'Без голоса фракции'):'1 голос'}</b></li>})}</ul>
  {body==='gd'?<div className="civicGdPresenceForm">
   <div><strong>Явка депутатов</strong><p>По умолчанию присутствуют все <b>{gdPresence?.my_capacity??'…'}</b> депутатов, которых Вы представляете. Если пришли не все, укажите фактическое число. Гоствойтинг и ограничения мандатов учитываются автоматически.</p></div>
   <label>Присутствуют депутаты
    <input type="number" min={0} max={gdPresence?.my_capacity??0} step={1} inputMode="numeric" value={presenceDraft} onChange={e=>setPresenceDraft(e.target.value)} disabled={!canAttend||!agendaReady||busy||readOnly||meetingActionsLocked||!gdPresence} aria-label="Количество присутствующих депутатов"/>
   </label>
   <button type="button" className="primary" disabled={!agendaReady||!canAttend||busy||readOnly||meetingActionsLocked||!gdPresence||presenceDraft.trim()===''||!Number.isInteger(Number(presenceDraft))||Number(presenceDraft)<0||Number(presenceDraft)>(gdPresence.my_capacity||0)} onClick={()=>void saveGdPresence()}>{mine?'Изменить явку':'Зарегистрироваться на заседание'}</button>
  </div>:<button type="button" className="primary" disabled={mine||!agendaReady||!canAttend||busy||readOnly||meetingActionsLocked} onClick={()=>void register()}>{mine?'Вы зарегистрированы':meetingActionsLocked?'Этап закрыт':!agendaReady?'Ожидается повестка':!verifiedRights?'Проверяем полномочия':canAttend?'Зарегистрироваться':'Нет назначения в этот орган'}</button>}</div>
  {g.teacher&&unit?.unit_kind==='public_body'&&<button className="secondary" onClick={()=>{setEditing(unit.id);setNewTitle(unit.title);setSeats(String(unit.mandate_capacity||1));setUsers(assignments.filter(a=>a.unit_id===unit.id).map(a=>a.user_id));setHead(unit.head_user_id||'');document.getElementById('civic-body-editor')?.setAttribute('open','')}}>Изменить состав выбранного органа</button>}
  {g.teacher&&<details id="civic-body-editor" className="civicCustomBody"><summary>Добавить другой орган или комиссию</summary><div className="civicBodyEditor"><label>Название органа<input value={newTitle} onChange={e=>setNewTitle(e.target.value)}/></label><label>Установленный состав органа, мест<input type="number" aria-label="Установленный состав органа" min={1} max={10000} step={1} inputMode="numeric" value={seats} onChange={e=>setSeats(e.target.value)}/></label><p>Назначено {users.length} из {seats||0} мест. Свободные места учитываются в общем составе при расчёте кворума.</p><fieldset><legend>Назначенные участники · {users.length}</legend>{students.map(m=><label className="civicCheckbox" key={m.user_id}><input type="checkbox" checked={users.includes(m.user_id)} onChange={e=>{setUsers(old=>e.target.checked?[...old,m.user_id]:old.filter(id=>id!==m.user_id));if(head===m.user_id&&!e.target.checked)setHead('')}}/>{m.full_name}</label>)}</fieldset><StyledSelect label="Председатель" value={head} onChange={setHead} options={[{value:'',label:'Не назначен'},...students.filter(m=>users.includes(m.user_id)).map(m=>({value:m.user_id,label:m.full_name}))]}/><button type="button" className="primary" disabled={busy||readOnly||newTitle.trim().length<3||!Number.isInteger(Number(seats))||Number(seats)<Math.max(1,users.length)||Number(seats)>10000} onClick={()=>void createBody()}>{editing?'Сохранить состав':'Создать орган'}</button></div></details>}
  {notice&&<p role="status">{notice}</p>}
 </div></details>;
}
