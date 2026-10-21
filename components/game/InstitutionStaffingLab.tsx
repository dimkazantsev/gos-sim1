'use client';
import {userError} from '@/lib/userError';
import {IconAction} from '../ui/IconAction';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';
import CommitteeChairElectionPanel from './CommitteeChairElectionPanel';
import {Landmark} from 'lucide-react';

type Unit={id:string;game_id:string;unit_kind:'committee'|'ministry';unit_key:string;title:string;description:string|null;capacity_min:number|null;capacity_max:number|null;mandate_capacity:number|null;head_user_id:string|null};
type Assignment={id:string;game_id:string;unit_id:string;unit_kind:'committee'|'ministry';user_id:string;party_id:string|null;assignment_role:'member'|'deputy'|'head';created_at:string};
type CommitteeAllocation={id:string;game_id:string;unit_id:string;user_id:string;party_id:string;mandates:number};

type Matrix={unit_id:string;title:string;party_id:string;party_name:string;color:string;quota:number;students:number;assigned_mandates:number;party_mandates:number};
type Minister={office_key:string;candidate_name:string;candidate_user_id:string|null};

export default function InstitutionStaffingLab({g,mode}:{g:ReturnTypeRepublic;mode:'committees'|'ministries'}){
 const {game,me,teacher,members,parties,setError}=g;
 const [units,setUnits]=useState<Unit[]>([]);
 const [assignments,setAssignments]=useState<Assignment[]>([]);
 const [committeeAllocations,setCommitteeAllocations]=useState<CommitteeAllocation[]>([]);
 const [matrix,setMatrix]=useState<Matrix[]>([]);
 const [ministers,setMinisters]=useState<Minister[]>([]);
 const [personalMandates,setPersonalMandates]=useState<{user_id:string;mandates:number}[]>([]);
 const [amount,setAmount]=useState<Record<string,string>>({});
 const [edits,setEdits]=useState<Record<string,string>>({});
 const [pick,setPick]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const role=stageRoleTitles(g);
 const isPM=role.includes('председател')&&role.includes('правительств');
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const canCreateCommittees=teacher||role.includes('председател')&&role.includes('дум')||role.includes('совет')&&role.includes('дум');
 const [loaded,setLoaded]=useState(false);
 const [loadError,setLoadError]=useState('');

 async function load(){
  if(!game)return;
  if(mode==='ministries'){
   const ready=await supabase.rpc('ensure_stage9_units',{p_game_id:game.id});
   if(ready.error){setLoadError(userError(ready.error));setLoaded(true);return;}
  }
  const [u,a,m,n,pm,ca]=await Promise.all([
   supabase.from('institution_units').select('*').eq('game_id',game.id).order('unit_kind').order('unit_key'),
   supabase.from('institution_assignments').select('*').eq('game_id',game.id).order('created_at'),
   mode==='committees'?supabase.rpc('get_committee_matrix',{p_game_id:game.id}):Promise.resolve({data:[],error:null}),
   mode==='ministries'?supabase.from('government_nominations').select('office_key,candidate_name,candidate_user_id').eq('game_id',game.id).eq('stage_no',9).eq('status','appointed').order('created_at'):Promise.resolve({data:[],error:null}),
   mode==='committees'?supabase.rpc('get_committee_deputy_capacity',{p_game_id:game.id}):Promise.resolve({data:[],error:null}),
   mode==='committees'?supabase.from('committee_mandate_allocations').select('*').eq('game_id',game.id).order('created_at'):Promise.resolve({data:[],error:null})
  ]);
  const failure=[u,a,m,n,pm,ca].find(x=>x.error);setLoaded(true);if(failure?.error){setLoadError(userError(failure.error));return;}setLoadError('');
  if(!u.error)setUnits((u.data||[]) as Unit[]);
  if(!a.error)setAssignments((a.data||[]) as Assignment[]);
  if(!m.error)setMatrix((m.data||[]) as Matrix[]);
  if(!n.error)setMinisters((n.data||[]) as Minister[]);
  if(!pm.error)setPersonalMandates((pm.data||[]) as typeof personalMandates);
  if(!ca.error)setCommitteeAllocations((ca.data||[]) as CommitteeAllocation[]);
 }
 useGameTableSync(game?.id,['institution_units','institution_assignments','committee_mandate_allocations','game_parties','party_member_mandates','government_nominations','government_structures'],load,(me?.user_id||'')+mode);

 if(!game||!me)return null;
 const activeMe=me;
 const committees=units.filter(x=>x.unit_kind==='committee');
 const ministries=units.filter(x=>x.unit_kind==='ministry');
 const students=members.filter(m=>m.kind==='student');
 // Leadership in other ministries does not occupy the single ordinary staff position.
 const ministryStaff=new Set(assignments.filter(a=>a.unit_kind==='ministry'&&a.assignment_role!=='head').map(a=>a.user_id));
 const memberName=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';
 const partyName=(id:string|null)=>parties.find(p=>p.id===id)?.name||'Без фракции';
 const committeeRows=(unitId:string)=>matrix.filter(x=>x.unit_id===unitId);
 const committeeMembers=(unitId:string)=>committeeAllocations.filter(x=>x.unit_id===unitId);
 const deputyCapacity=(uid:string)=>personalMandates.find(a=>a.user_id===uid)?.mandates||0;
 const totalAllocated=(uid:string)=>committeeAllocations.filter(a=>a.user_id===uid).reduce((n,a)=>n+a.mandates,0);
 const committeeTotal=(unitId:string)=>committeeMembers(unitId).reduce((n,a)=>n+a.mandates,0);
 const availableQuota=(unitId:string,uid:string)=>{
  const party=parties.find(p=>p.name===students.find(s=>s.user_id===uid)?.team);
  const row=committeeRows(unitId).find(r=>r.party_id===party?.id);
  if(!row)return 0;
  return Math.max(0,row.quota-row.assigned_mandates);
 };
 const maxNewAllocation=(u:Unit,uid:string)=>Math.max(0,Math.min(
  deputyCapacity(uid)-totalAllocated(uid),
  Number(u.mandate_capacity||90)-committeeTotal(u.id),availableQuota(u.id,uid)));
 const canManageUnit=(u:Unit)=>teacher||!!ledParty||u.head_user_id===me.user_id;
 const canEditAllocation=(u:Unit,a:CommitteeAllocation)=>teacher||u.head_user_id===me.user_id||ledParty?.id===a.party_id;
 const assignedTo=(unitId:string)=>assignments.filter(a=>a.unit_id===unitId);
 const canManageCommittee=teacher||!!ledParty;
 const canManageMinistry=(u:Unit)=>teacher||isPM||u.head_user_id===activeMe.user_id;
 const committeeCandidates=ledParty&&!teacher?students.filter(s=>s.team===ledParty.name):students;

 async function assign(unitId:string){
  const uid=pick[unitId];if(!uid)return;setBusy(true);
  const r=await supabase.rpc('assign_institution_member',{p_unit_id:unitId,p_user_id:uid});
  if(r.error)setError(userError(r.error));else{setPick(v=>({...v,[unitId]:''}));await load()}setBusy(false);
 }
 async function setCommitteeMandates(unitId:string,uid:string,value:number){
  if(!Number.isInteger(value)||value<0){setError('Укажите целое число мандатов.');return;}
  setBusy(true);
  try {
   const r=await supabase.rpc('set_committee_mandates',{p_unit_id:unitId,p_user_id:uid,p_mandates:value});
   if(r.error)setError(userError(r.error));
   else {setPick(v=>({...v,[unitId]:''}));setAmount(v=>({...v,[unitId]:'1'}));await load()}
  } finally {setBusy(false)}
 }
 async function remove(id:string){setBusy(true);const r=await supabase.rpc('remove_institution_member',{p_assignment_id:id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}
 async function createCommittees(){setBusy(true);const r=await supabase.rpc('ensure_duma_committees',{p_game_id:game!.id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}

 const ministryCounts=ministries.map(u=>assignedTo(u.id).length);
 const minCount=ministryCounts.length?Math.min(...ministryCounts):0;
 const maxCount=ministryCounts.length?Math.max(...ministryCounts):0;
 const assignedSeats=committeeAllocations.reduce((n,a)=>n+a.mandates,0);

 return <section className="staffingLab" data-staffing={mode}>
  <header className="staffingLabHead">
   {mode==='committees'?<div className="staffingLabIntro">
    <div className="staffingLabEyebrow"><Landmark size={17} aria-hidden="true"/><span>Государственная Дума</span><span className="staffingLabStage">Этап 4</span></div>
    <h2>Формирование комитетов Государственной Думы</h2>
    <p>Палата образует пять комитетов и избирает их председателей. После выборов депутаты распределяются по комитетам с учётом фракционных квот.</p>
   </div>:<div><h2>Команды министерств</h2><p>Министры, назначенные на этом этапе, набирают сотрудников своих ведомств. Участник может состоять только в одном министерстве как сотрудник; министры вправе руководить несколькими ведомствами. Партийная принадлежность не определяет распределение.</p></div>}
   {mode==='committees'?<div className="staffingBalance" aria-label={'Распределено депутатских мандатов по комитетам: '+assignedSeats+' из 450'}>
    <span>Распределение мандатов</span><strong>{assignedSeats} / 450</strong><em>Мандатов распределено</em>
   </div>:<div className="staffingBalance"><strong>{assignments.filter(a=>a.unit_kind==='ministry').length}</strong><span>В министерствах</span></div>}
  </header>
  {loadError&&<div className="stageOperationsNotice" role="alert"><p>{loadError}</p><button type="button" onClick={()=>void load()}>Повторить загрузку</button></div>}
  {!loaded&&<p role="status">Загрузка состава…</p>}
  {mode==='committees'&&loaded&&!loadError&&committees.length<5&&<div className="stageOperationsActionBar"><p>Создайте пять комитетов по направлениям, заданным правилами игры. Уже существующие составы и результаты выборов сохраняются.</p>{canCreateCommittees?<button type="button" className="primary" disabled={busy} onClick={()=>void createCommittees()}>Создать комитеты ГД</button>:<span>Создание доступно Председателю, Совету ГД и преподавателю.</span>}</div>}
  {mode==='ministries'&&loaded&&!loadError&&!ministries.length&&<p className="stageOperationsNotice">Сначала утвердите структуру Правительства на этапе 8. После этого здесь появятся ведомства.</p>}

  {mode==='committees'&&committees.length>0&&<CommitteeChairElectionPanel g={g}/>}
  {mode==='committees'&&committees.length>0&&<section className="staffingSection">
   <div className="staffingSectionHead"><div><small>ГОСУДАРСТВЕННАЯ ДУМА</small><h3>5 комитетов · пропорциональное представительство фракций</h3><p>Сначала депутаты выбирают Председателя Государственной Думы, затем выдвигают и обсуждают кандидатуры председателей комитетов и голосуют за них. После этого избранные председатели совместно с фракциями распределяют депутатов по комитетам. Договоритесь об этом в общем чате. Каждый комитет моделирует 90 мест, а квоты автоматически пересчитываются по мандатам. Один депутат может распределить свой пакет мандатов между несколькими комитетами. Назначение доступно после избрания председателя соответствующего комитета.</p></div><span>Каждый комитет — 90 мандатов</span></div>

   <div className="committeeGrid">{committees.map(u=>{
    const aa=committeeMembers(u.id),rows=committeeRows(u.id),used=committeeTotal(u.id);
    const allowed=canManageUnit(u);
    const candidates=(u.head_user_id===activeMe.user_id||teacher?students:committeeCandidates)
     .filter(student=>!aa.some(a=>a.user_id===student.user_id)&&maxNewAllocation(u,student.user_id)>0);
    const chosen=pick[u.id]||'';
    const maxAmount=chosen?maxNewAllocation(u,chosen):0;
    return <article className="institutionUnit committeeUnit" key={u.id}>
     <header><div><small>КОМИТЕТ</small><h4>{u.title}</h4><p>{u.description}</p></div><span>{used} / {u.mandate_capacity||90} мандатов</span></header>
     <div className="committeeQuota">{rows.map(r=><div key={r.party_id}><i style={{background:r.color}}/><b>{r.party_name}</b><strong>{r.assigned_mandates} / {r.quota}</strong><span>{r.students} представителей</span></div>)}</div>
     <div className="unitHead"><small>ПРЕДСЕДАТЕЛЬ</small><b>{memberName(u.head_user_id)}</b><span className="unitHeadElectionHint">Избирается депутатами Государственной Думы в блоке выше. Само избрание не распределяет мандаты.</span></div>
     <div className="unitMembers">{aa.length===0?<div className="emptyState">Мандаты пока не распределены.</div>:aa.map(a=>{
      const currentMax=Math.min(deputyCapacity(a.user_id)-totalAllocated(a.user_id)+a.mandates,
         Number(u.mandate_capacity||90)-used+a.mandates,
         (rows.find(row=>row.party_id===a.party_id)?.quota||0)-(rows.find(row=>row.party_id===a.party_id)?.assigned_mandates||0)+a.mandates);
      return <div key={a.id} className="committeeMandateMember"><span>{memberName(a.user_id)}</span><small>{partyName(a.party_id)}</small><b>{a.mandates} манд.</b>{canEditAllocation(u,a)&&<div className="committeeMandateEdit"><input type="number" aria-label={'Мандаты '+memberName(a.user_id)} min={0} max={Math.max(0,currentMax)} step={1} value={edits[a.id]??String(a.mandates)} onChange={e=>setEdits(v=>({...v,[a.id]:e.target.value}))}/><button type="button" disabled={busy||!Number.isInteger(Number(edits[a.id]??a.mandates))||Number(edits[a.id]??a.mandates)<0||Number(edits[a.id]??a.mandates)>currentMax||Number(edits[a.id]??a.mandates)===a.mandates} onClick={()=>void setCommitteeMandates(u.id,a.user_id,Number(edits[a.id]??a.mandates))}>Сохранить</button><IconAction variant="remove" onClick={()=>void setCommitteeMandates(u.id,a.user_id,0)} label={'Снять мандаты '+memberName(a.user_id)}/></div>}</div>
     })}</div>
     {!!u.head_user_id&&allowed&&<div className="unitAssign committeeMandateAssign"><select aria-label={'Представитель в '+u.title} value={chosen} onChange={e=>{setPick(v=>({...v,[u.id]:e.target.value}));setAmount(v=>({...v,[u.id]:'1'}))}}><option value="">Выберите депутата…</option>{candidates.map(student=><option key={student.user_id} value={student.user_id}>{student.full_name}{student.team?' · '+student.team:''} · свободно {maxNewAllocation(u,student.user_id)}</option>)}</select><input aria-label={'Число мандатов в '+u.title} type="number" min={1} max={maxAmount||1} step={1} value={amount[u.id]??'1'} onChange={e=>setAmount(v=>({...v,[u.id]:e.target.value}))} disabled={!chosen||busy}/><button disabled={busy||!chosen||!Number.isInteger(Number(amount[u.id]??'1'))||Number(amount[u.id]??'1')<1||Number(amount[u.id]??'1')>maxAmount} onClick={()=>void setCommitteeMandates(u.id,chosen,Number(amount[u.id]??'1'))}>Распределить</button></div>}
     <p className="committeeMandateRemainder">{used===Number(u.mandate_capacity||90)?'Комитет укомплектован по мандатам.':'Осталось распределить '+(Number(u.mandate_capacity||90)-used)+' мандатов.'}</p>
    </article>
   })}</div>
  </section>}

  {mode==='ministries'&&ministries.length>0&&<section className="staffingSection ministrySection">
   <div className="staffingSectionHead"><div><small>ПРАВИТЕЛЬСТВО</small><h3>5 министерств · беспартийный кадровый принцип</h3><p>Министры набирают заместителей и участников своих ведомств. Партийная принадлежность здесь не используется как критерий распределения; система показывает дисбаланс численности между ведомствами.</p></div><span className={maxCount-minCount>1?'warn':''}>Разброс {minCount}–{maxCount}</span></div>
   <div className="ministryGrid">{ministries.map(u=>{
    const minister=ministers.find(n=>n.office_key==='ministry_'+u.unit_key);
    const aa=assignedTo(u.id),count=aa.length,balanced=count>=Number(u.capacity_min||3)&&count<=Number(u.capacity_max||5);
    return <article className={'institutionUnit ministryUnit '+(balanced?'balanced':'')} key={u.id}>
     <header><div><small>МИНИСТЕРСТВО</small><h4>{u.title}</h4><p>{u.description}</p></div><span>{count} / {u.capacity_min||3}–{u.capacity_max||5}</span></header>
     <div className="unitHead"><small>Министр · назначение этапа 9</small><b>{minister?.candidate_name||'Ещё не назначен'}</b>{!minister&&<span>Кандидатура и назначение находятся выше</span>}</div>
     <div className="unitMembers">{aa.length===0?<div className="emptyState">Ведомство пока не укомплектовано.</div>:aa.map(a=><div key={a.id}><span>{memberName(a.user_id)}</span><small>{a.assignment_role==='head'?'Министр':'Член министерства'}</small>{canManageMinistry(u)&&a.assignment_role!=='head'&&<IconAction variant="remove" onClick={()=>void remove(a.id)} label={'Исключить участника '+memberName(a.user_id)}/>}</div>)}</div>
     {canManageMinistry(u)&&minister&&<div className="unitAssign"><select aria-label={'Добавить сотрудника: '+u.title} value={pick[u.id]||''} onChange={e=>setPick(v=>({...v,[u.id]:e.target.value}))}><option value="">Добавить участника…</option>{students.filter(s=>!ministryStaff.has(s.user_id)&&!aa.some(a=>a.user_id===s.user_id)).map(s=><option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select><button disabled={busy||!pick[u.id]} onClick={()=>void assign(u.id)}>Добавить</button></div>}
    </article>
   })}</div>
  </section>}

  <footer className="staffingRule"><b>Правила модели</b><p>{mode==='committees'?'Пять комитетов по 90 мандатов. Депутат вправе представлять фракцию в нескольких комитетах, но сумма его распределённых мандатов ограничена личным пакетом. Сервер проверяет квоты фракций и состав.':'Пять ведомств с ориентиром 3–5 человек. Министр может руководить несколькими ведомствами. Рядовой сотрудник состоит в одном министерстве и может отдельно быть депутатом комитета Государственной Думы.'}</p></footer>
 </section>;
}
