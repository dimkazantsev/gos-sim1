'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
import StyledSelect from '../ui/StyledSelect';
import {VOTING_BODIES,bodyQuorum,type VotingUnit} from './votingBodies';
import {ClipboardCheck} from 'lucide-react';
import DisclosureSummary from '../ui/DisclosureSummary';
type Entry={user_id:string;institution_key:string;stage_no:number};
type Assignment={unit_id:string;user_id:string};
type Office={user_id:string;role_title:string};
type MeetingRecord={game_id:string;stage_no:number;institution_key:string;agenda_document_id:string|null;agenda_body:string|null;agenda_approved_at:string|null;minutes_document_id:string|null;minutes_body:string|null;minutes_approved_at:string|null;delegate_user_id:string|null};
export default function InstitutionRegistrationPanel({g,readOnly=false,onUnitsChange,stageNo,initialBody,allowedBodies,defaultOpen=false}:{g:ReturnTypeRepublic;readOnly?:boolean;onUnitsChange?:(units:VotingUnit[])=>void;stageNo?:number;initialBody?:string;allowedBodies?:string[];defaultOpen?:boolean}){
 const [rows,setRows]=useState<Entry[]>([]),[units,setUnits]=useState<VotingUnit[]>([]),[assignments,setAssignments]=useState<Assignment[]>([]),[offices,setOffices]=useState<Office[]>([]);
 const [body,setBody]=useState(initialBody||'gd'),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[newTitle,setNewTitle]=useState(''),[users,setUsers]=useState<string[]>([]),[head,setHead]=useState('');
 const [seats,setSeats]=useState('1'),[editing,setEditing]=useState<string|null>(null);
 const [meetingRows,setMeetingRows]=useState<MeetingRecord[]>([]);
 const [agendaText,setAgendaText]=useState(''),[minutesText,setMinutesText]=useState(''),[delegateUser,setDelegateUser]=useState('');
 const detailsRef=useRef<HTMLDetailsElement>(null);
 const stage=stageNo||g.game?.current_round||1,students=g.members.filter(m=>m.kind==='student');
 async function load(){if(!g.game)return;const [r,u,a,b,o,meeting]=await Promise.all([supabase.from('institution_session_registrations').select('user_id,institution_key,stage_no').eq('game_id',g.game.id).eq('stage_no',stage),supabase.from('institution_units').select('id,title,unit_kind,head_user_id,unit_key,mandate_capacity').eq('game_id',g.game.id),supabase.from('institution_assignments').select('unit_id,user_id').eq('game_id',g.game.id),supabase.from('game_voting_body_members').select('unit_id,user_id').eq('game_id',g.game.id),supabase.from('game_office_assignments').select('user_id,role_title').eq('game_id',g.game.id).eq('status','active'),
  supabase.from('institution_meeting_records').select('game_id,stage_no,institution_key,agenda_document_id,agenda_body,agenda_approved_at,minutes_document_id,minutes_body,minutes_approved_at,delegate_user_id').eq('game_id',g.game.id).eq('stage_no',stage)]);
  const failure=[r,u,a,b,o,meeting].find(x=>x.error);if(failure?.error){g.setError(failure.error.message);return;}
  if(!r.error)setRows(r.data||[]);if(!u.error){setUnits(u.data||[]);onUnitsChange?.(u.data||[])}setAssignments([...(a.data||[]),...(b.data||[])]);if(!o.error)setOffices(o.data||[]);if(!meeting.error)setMeetingRows((meeting.data||[]) as MeetingRecord[]);
 }
 useEffect(()=>{if(initialBody)setBody(initialBody)},[initialBody]);
 useEffect(()=>{if(defaultOpen&&detailsRef.current)detailsRef.current.open=true},[defaultOpen,stage,initialBody]);
 useGameTableSync(g.game?.id,['institution_session_registrations','institution_units','institution_assignments','game_voting_body_members','game_office_assignments','institution_meeting_records','formal_documents'],load,String(stage));
 useEffect(()=>{const row=meetingRows.find(m=>m.institution_key===body);setAgendaText(row?.agenda_body||'');setMinutesText(row?.minutes_body||'');setDelegateUser(row?.delegate_user_id||'')},[meetingRows,body]);
 if(!g.game||!g.me)return null;
 const availableBodies=VOTING_BODIES.filter(item=>!allowedBodies||allowedBodies.includes(item.key));
 const config=VOTING_BODIES.find(b=>b.key===body),unit=units.find(u=>'unit:'+u.id===body);
 function eligible(uid:string){const m=g.members.find(x=>x.user_id===uid);if(!m||m.kind==='observer')return false;if(unit)return assignments.some(a=>a.unit_id===unit.id&&a.user_id===uid);if(body==='ksrf')return m.kind==='student'||g.parties.some(p=>p.leader_user_id===uid);return !!config&&(config.role.test(m.role_title||'')||(m.kind==='student'&&offices.some(o=>o.user_id===uid&&config.role.test(o.role_title))))}
 const participants=g.members.filter(m=>eligible(m.user_id));
 const registered=rows.filter(r=>r.institution_key===body&&participants.some(m=>m.user_id===r.user_id));
 const mine=rows.some(r=>r.institution_key===body&&r.user_id===g.me?.user_id);
 const factionCount=body==='ksrf'?g.parties.length:0;
 const total=body==='ksrf'?factionCount:body==='gd'?450:body==='government'?participants.length:body==='municipality'?participants.length:unit?.mandate_capacity??participants.length;
 const present=body==='ksrf'?new Set(registered.map(r=>g.parties.find(p=>p.leader_user_id===r.user_id)?.id).filter(Boolean)).size:body==='gd'?registered.reduce((n,r)=>n+(g.partyMandates.find(a=>a.user_id===r.user_id)?.effective_mandates||0),0):registered.length;
 const needed=bodyQuorum(body,total);
 const meetingRecord=meetingRows.find(m=>m.institution_key===body);
 const agendaReady=!!meetingRecord?.agenda_approved_at;
 const meetingCoordinator=!!g.teacher||(body==='ksrf'&&g.parties.some(p=>p.leader_user_id===g.me?.user_id))||(unit?.head_user_id===g.me?.user_id)||offices.some(o=>o.user_id===g.me?.user_id&&/председател|руководител|глава|директор/i.test(o.role_title)&&!!(config?.role.test(o.role_title)));
 const canPrepare=meetingCoordinator||meetingRecord?.delegate_user_id===g.me?.user_id;
 async function saveMeetingDocument(kind:'agenda'|'minutes'){
  if(!g.game||busy)return;
  setBusy(true);
  const r=await supabase.rpc('save_institution_meeting_document',{p_game_id:g.game.id,p_stage_no:stage,p_institution:body,p_kind:kind,p_body:kind==='agenda'?agendaText:minutesText});
  if(r.error)g.setError(r.error.message);else{await load();setNotice(kind==='agenda'?'Повестка сохранена в реестре НПА.':'Протокол сохранён в реестре НПА.')}
  setBusy(false);
 }
 async function approveMeeting(kind:'agenda'|'minutes'){
  if(!g.game||busy)return;setBusy(true);
  const r=await supabase.rpc(kind==='agenda'?'approve_institution_meeting_agenda':'approve_institution_meeting_minutes',{p_game_id:g.game.id,p_stage_no:stage,p_institution:body});
  if(r.error)g.setError(r.error.message);else{await load();setNotice(kind==='agenda'?'Повестка утверждена. Регистрация доступна.':'Протокол утверждён.')}
  setBusy(false);
 }
 async function assignMeetingDelegate(){
  if(!g.game||!meetingCoordinator||busy)return;setBusy(true);
  const r=await supabase.rpc('assign_institution_meeting_secretary',{p_game_id:g.game.id,p_stage_no:stage,p_institution:body,p_delegate:delegateUser||null});
  if(r.error)g.setError(r.error.message);else{await load();setNotice('Ответственный исполнитель сохранён.')}
  setBusy(false);
 }
 async function register(){if(!g.game)return;setBusy(true);const r=await supabase.rpc('register_institution_session_at_stage',{p_game_id:g.game.id,p_institution:body,p_stage_no:stage});if(r.error)g.setError(r.error.message);else{await load();setNotice('Вы зарегистрированы на заседание.')}setBusy(false)}
 async function createBody(){if(!g.game)return;setBusy(true);const r=await supabase.rpc('save_civic_voting_body',{p_game_id:g.game.id,p_title:newTitle.trim(),p_seats:Number(seats),p_users:users,p_head:head||null,p_unit:editing});if(r.error)g.setError(r.error.message);else{await load();setBody('unit:'+r.data);setNewTitle('');setUsers([]);setHead('');setSeats('1');setEditing(null);setNotice('Состав органа сохранён. Его можно выбрать при открытии голосования.')}setBusy(false)}
 return <details ref={detailsRef} className="institutionRegistrationPanel civicRegistration civicDisclosure projectDisclosure" aria-label="Регистрация на заседания"><DisclosureSummary icon={ClipboardCheck} title="Регистрация на заседание" description={'Этап '+stage+' · Регистрация в органе власти'}/><div className="civicDisclosureBody"><p>До внесения предложений и голосования зарегистрируйтесь на заседание нужного органа. В КСРФ участвуют все студенты, но право подать один голос от фракции принадлежит её избранному представителю.</p>
  <div className="civicRegistrationSelectors"><StyledSelect label="Орган" value={body} onChange={setBody} options={[...availableBodies.map(b=>({value:b.key,label:b.title})),...units.filter(u=>!allowedBodies||allowedBodies.includes('unit:'+u.id)).map(u=>({value:'unit:'+u.id,label:u.title}))]}/></div>
  <section className="civicMeetingDocuments" aria-label="Документы заседания">
   <header><div><b>Повестка заседания</b><small>{agendaReady?'Утверждена · регистрация разрешена':meetingRecord?.agenda_document_id?'Ожидает утверждения председателем':'Сначала подготовьте документ в реестре НПА'}</small></div><span>{meetingRecord?.agenda_document_id?'В реестре НПА':'Не оформлена'}</span></header>
   {canPrepare&&!agendaReady&&<label>Содержание повестки<textarea aria-label="Текст повестки заседания" value={agendaText} rows={4} onChange={event=>setAgendaText(event.target.value)} placeholder="Вопросы заседания, порядок рассмотрения, выступающие и регламент"/></label>}
   {canPrepare&&!agendaReady&&<button type="button" className="secondary" disabled={busy||agendaText.trim().length<30} onClick={()=>void saveMeetingDocument('agenda')}>Сохранить повестку как документ</button>}
   {meetingCoordinator&&!agendaReady&&<button type="button" className="primary" disabled={busy} onClick={()=>void approveMeeting('agenda')}>Утвердить повестку из реестра</button>}
   {meetingCoordinator&&<div className="civicMeetingDelegate"><StyledSelect label="Поручить заполнение повестки и протокола" value={delegateUser} onChange={setDelegateUser} options={[{value:'',label:'Без поручения'},...participants.map(p=>({value:p.user_id,label:p.full_name||'Участник'}))]}/><button type="button" disabled={busy} onClick={()=>void assignMeetingDelegate()}>Сохранить поручение</button></div>}
   {registered.length>0&&<div className="civicMeetingMinutes"><header><b>Протокол по итогам заседания</b><span>{meetingRecord?.minutes_approved_at?'Утверждён':meetingRecord?.minutes_document_id?'Проект на утверждении':'Не составлен'}</span></header>
    {canPrepare&&!meetingRecord?.minutes_approved_at&&<><label>Содержание протокола<textarea aria-label="Текст протокола заседания" rows={5} value={minutesText} onChange={event=>setMinutesText(event.target.value)} placeholder="Присутствовали, кворум, вопросы, результаты голосований и постановления"/></label><button type="button" className="secondary" disabled={busy||minutesText.trim().length<30} onClick={()=>void saveMeetingDocument('minutes')}>Сохранить протокол как документ</button></>}
    {meetingCoordinator&&meetingRecord?.minutes_document_id&&!meetingRecord?.minutes_approved_at&&<button type="button" className="primary" disabled={busy} onClick={()=>void approveMeeting('minutes')}>Утвердить протокол</button>}
   </div>}
  </section>
  <div className="civicAttendance"><div><h3>{config?.title||unit?.title}</h3><p>{config?.basis||'Состав зарегистрированного в игре органа. Порог задаётся в голосовании.'}</p></div><div className="civicAttendanceNumbers"><span>Присутствует <b>{present} / {total}</b></span><span>Для кворума <b>{needed}</b></span><span>{present>=needed&&total>0?'Кворум есть':'Ожидаем участников'}</span></div><ul className="civicAttendees">{registered.map(r=>{const faction=body==='ksrf'?g.parties.find(p=>p.leader_user_id===r.user_id):null;return <li key={r.user_id}>{body==='ksrf'?(faction?.name||'Участник КСРФ')+' · '+(g.names[r.user_id]||'Участник'):g.names[r.user_id]||'Участник'}<b>{body==='gd'?(g.partyMandates.find(a=>a.user_id===r.user_id)?.effective_mandates||0)+' голосов':body==='ksrf'?(faction?'1 голос фракции':'Без голоса фракции'):'1 голос'}</b></li>})}</ul><button type="button" className="primary" disabled={mine||!agendaReady||!eligible(g.me.user_id)||busy||readOnly} onClick={()=>void register()}>{mine?'Вы зарегистрированы':!agendaReady?'Ожидается повестка':eligible(g.me.user_id)?'Зарегистрироваться':'Нет назначения в этот орган'}</button></div>
  {g.teacher&&unit?.unit_kind==='public_body'&&<button className="secondary" onClick={()=>{setEditing(unit.id);setNewTitle(unit.title);setSeats(String(unit.mandate_capacity||1));setUsers(assignments.filter(a=>a.unit_id===unit.id).map(a=>a.user_id));setHead(unit.head_user_id||'');document.getElementById('civic-body-editor')?.setAttribute('open','')}}>Изменить состав выбранного органа</button>}
  {g.teacher&&<details id="civic-body-editor" className="civicCustomBody"><summary>Добавить другой орган или комиссию</summary><div className="civicBodyEditor"><label>Название органа<input value={newTitle} onChange={e=>setNewTitle(e.target.value)}/></label><label>Установленный состав органа, мест<input type="number" aria-label="Установленный состав органа" min={1} max={10000} step={1} inputMode="numeric" value={seats} onChange={e=>setSeats(e.target.value)}/></label><p>Назначено {users.length} из {seats||0} мест. Свободные места учитываются в общем составе при расчёте кворума.</p><fieldset><legend>Назначенные участники · {users.length}</legend>{students.map(m=><label className="civicCheckbox" key={m.user_id}><input type="checkbox" checked={users.includes(m.user_id)} onChange={e=>{setUsers(old=>e.target.checked?[...old,m.user_id]:old.filter(id=>id!==m.user_id));if(head===m.user_id&&!e.target.checked)setHead('')}}/>{m.full_name}</label>)}</fieldset><StyledSelect label="Председатель" value={head} onChange={setHead} options={[{value:'',label:'Не назначен'},...students.filter(m=>users.includes(m.user_id)).map(m=>({value:m.user_id,label:m.full_name}))]}/><button type="button" className="primary" disabled={busy||readOnly||newTitle.trim().length<3||!Number.isInteger(Number(seats))||Number(seats)<Math.max(1,users.length)||Number(seats)>10000} onClick={()=>void createBody()}>{editing?'Сохранить состав':'Создать орган'}</button></div></details>}
  {notice&&<p role="status">{notice}</p>}
 </div></details>;
}
