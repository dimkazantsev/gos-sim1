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
type Matrix={unit_id:string;title:string;party_id:string;party_name:string;color:string;quota:number;students:number};
type Minister={office_key:string;candidate_name:string;candidate_user_id:string|null};

export default function InstitutionStaffingLab({g,mode}:{g:ReturnTypeRepublic;mode:'committees'|'ministries'}){
 const {game,me,teacher,members,parties,setError}=g;
 const [units,setUnits]=useState<Unit[]>([]);
 const [assignments,setAssignments]=useState<Assignment[]>([]);
 const [matrix,setMatrix]=useState<Matrix[]>([]);
 const [ministers,setMinisters]=useState<Minister[]>([]);
 const [personalMandates,setPersonalMandates]=useState<{user_id:string;base_mandates:number}[]>([]);
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
  const [u,a,m,n,pm]=await Promise.all([
   supabase.from('institution_units').select('*').eq('game_id',game.id).order('unit_kind').order('unit_key'),
   supabase.from('institution_assignments').select('*').eq('game_id',game.id).order('created_at'),
   mode==='committees'?supabase.rpc('get_committee_matrix',{p_game_id:game.id}):Promise.resolve({data:[],error:null}),
   mode==='ministries'?supabase.from('government_nominations').select('office_key,candidate_name,candidate_user_id').eq('game_id',game.id).eq('stage_no',9).eq('status','appointed').order('created_at'):Promise.resolve({data:[],error:null}),
   mode==='committees'?supabase.from('party_member_mandates').select('user_id,base_mandates').eq('game_id',game.id):Promise.resolve({data:[],error:null})
  ]);
  const failure=[u,a,m,n,pm].find(x=>x.error);setLoaded(true);if(failure?.error){setLoadError(userError(failure.error));return;}setLoadError('');
  if(!u.error)setUnits((u.data||[]) as Unit[]);
  if(!a.error)setAssignments((a.data||[]) as Assignment[]);
  if(!m.error)setMatrix((m.data||[]) as Matrix[]);
  if(!n.error)setMinisters((n.data||[]) as Minister[]);
  if(!pm.error)setPersonalMandates((pm.data||[]) as typeof personalMandates);
 }
 useGameTableSync(game?.id,['institution_units','institution_assignments','game_parties','party_member_mandates','government_nominations','government_structures'],load,(me?.user_id||'')+mode);

 if(!game||!me)return null;
 const activeMe=me;
 const committees=units.filter(x=>x.unit_kind==='committee');
 const ministries=units.filter(x=>x.unit_kind==='ministry');
 const students=members.filter(m=>m.kind==='student');
 const assignmentFor=(uid:string,kind:'committee'|'ministry')=>assignments.find(a=>a.user_id===uid&&a.unit_kind===kind);
 const memberName=(id:string|null)=>members.find(m=>m.user_id===id)?.full_name||'—';
 const partyName=(id:string|null)=>parties.find(p=>p.id===id)?.name||'Без фракции';
 const committeeRows=(unitId:string)=>matrix.filter(x=>x.unit_id===unitId);
 const assignedTo=(unitId:string)=>assignments.filter(a=>a.unit_id===unitId);
 const canManageCommittee=teacher||!!ledParty;
 const canManageMinistry=(u:Unit)=>teacher||isPM||u.head_user_id===activeMe.user_id;
 const committeeCandidates=ledParty&&!teacher?students.filter(s=>s.team===ledParty.name):students;

 async function assign(unitId:string){
  const uid=pick[unitId];if(!uid)return;setBusy(true);
  const r=await supabase.rpc('assign_institution_member',{p_unit_id:unitId,p_user_id:uid});
  if(r.error)setError(userError(r.error));else{setPick(v=>({...v,[unitId]:''}));await load()}setBusy(false);
 }
 async function remove(id:string){setBusy(true);const r=await supabase.rpc('remove_institution_member',{p_assignment_id:id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}
 async function createCommittees(){setBusy(true);const r=await supabase.rpc('ensure_duma_committees',{p_game_id:game!.id});if(r.error)setError(userError(r.error));else await load();setBusy(false)}

 const ministryCounts=ministries.map(u=>assignedTo(u.id).length);
 const minCount=ministryCounts.length?Math.min(...ministryCounts):0;
 const maxCount=ministryCounts.length?Math.max(...ministryCounts):0;

 return <section className="staffingLab" data-staffing={mode}>
  <header className="staffingLabHead">
   {mode==='committees'?<div className="staffingLabIntro">
    <div className="staffingLabEyebrow"><Landmark size={17} aria-hidden="true"/><span>Государственная Дума</span><span className="staffingLabStage">Этап 4</span></div>
    <h2>Формирование комитетов Государственной Думы</h2>
    <p>Палата образует пять комитетов и избирает их председателей. После выборов депутаты распределяются по комитетам с учётом фракционных квот.</p>
   </div>:<div><h2>Команды министерств</h2><p>Министры, назначенные на этом этапе, набирают сотрудников своих ведомств. Участник может состоять только в одном министерстве; партийная принадлежность не определяет распределение.</p></div>}
   {mode==='committees'?<div className="staffingBalance" aria-label={'Распределено депутатов по комитетам: '+assignments.filter(a=>a.unit_kind==='committee').length}>
    <span>Составы комитетов</span><strong>{assignments.filter(a=>a.unit_kind==='committee').length}</strong><em>депутатов распределено</em>
   </div>:<div className="staffingBalance"><strong>{assignments.filter(a=>a.unit_kind==='ministry').length}</strong><span>в министерствах</span></div>}
  </header>
  {loadError&&<div className="stageOperationsNotice" role="alert"><p>{loadError}</p><button type="button" onClick={()=>void load()}>Повторить загрузку</button></div>}
  {!loaded&&<p role="status">Загрузка состава…</p>}
  {mode==='committees'&&loaded&&!loadError&&committees.length<5&&<div className="stageOperationsActionBar"><p>Создайте пять комитетов по направлениям, заданным правилами игры. Уже существующие составы и результаты выборов сохраняются.</p>{canCreateCommittees?<button type="button" className="primary" disabled={busy} onClick={()=>void createCommittees()}>Создать комитеты ГД</button>:<span>Создание доступно Председателю, Совету ГД и преподавателю.</span>}</div>}
  {mode==='ministries'&&loaded&&!loadError&&!ministries.length&&<p className="stageOperationsNotice">Сначала утвердите структуру Правительства на этапе 8. После этого здесь появятся ведомства.</p>}

  {mode==='committees'&&committees.length>0&&<CommitteeChairElectionPanel g={g}/>}
  {mode==='committees'&&committees.length>0&&<section className="staffingSection">
   <div className="staffingSectionHead"><div><small>ГОСУДАРСТВЕННАЯ ДУМА</small><h3>5 комитетов · пропорциональное представительство фракций</h3><p>Сначала депутаты выбирают Председателя Государственной Думы, затем выдвигают и обсуждают кандидатуры председателей комитетов и голосуют за них. После этого избранные председатели совместно с фракциями распределяют депутатов по комитетам. Договоритесь об этом в общем чате. Каждый комитет моделирует 90 мест, а квоты автоматически пересчитываются по мандатам. Один депутат состоит только в одном комитете. Назначение доступно после избрания председателя соответствующего комитета.</p></div><span>1 студент → 1 комитет</span></div>
   <div className="committeeGrid">{committees.map(u=>{
    const aa=assignedTo(u.id),rows=committeeRows(u.id);
    return <article className="institutionUnit committeeUnit" key={u.id}>
     <header><div><small>КОМИТЕТ</small><h4>{u.title}</h4><p>{u.description}</p></div><span>{aa.length} студентов</span></header>
     <div className="committeeQuota">{rows.map(r=><div key={r.party_id}><i style={{background:r.color}}/><b>{r.party_name}</b><strong>{r.quota}</strong><span>{r.students} студент(а)</span></div>)}</div>
     <div className="unitHead"><small>ПРЕДСЕДАТЕЛЬ</small><b>{memberName(u.head_user_id)}</b><span className="unitHeadElectionHint">Избирается депутатами Государственной Думы в блоке выше</span></div>
     <div className="unitMembers">{aa.length===0?<div className="emptyState">Состав не сформирован.</div>:aa.map(a=>{const row=rows.find(r=>r.party_id===a.party_id);const partyStudents=Math.max(1,row?.students||1);const weight=(row?.quota||0)/partyStudents;return <div key={a.id}><span>{memberName(a.user_id)}</span><small>{partyName(a.party_id)}</small><b>≈ {weight.toFixed(1)} мандата</b>{!!u.head_user_id&&(canManageCommittee||u.head_user_id===activeMe.user_id)&&(!ledParty||a.party_id===ledParty.id||teacher||u.head_user_id===activeMe.user_id)&&<IconAction variant="remove" onClick={()=>void remove(a.id)} label={'Исключить участника '+memberName(a.user_id)}/>}</div>})}</div>
     {!!u.head_user_id&&(canManageCommittee||u.head_user_id===activeMe.user_id)&&<div className="unitAssign"><select aria-label={'Добавить депутата: '+u.title} value={pick[u.id]||''} onChange={e=>setPick(v=>({...v,[u.id]:e.target.value}))}><option value="">Добавить депутата…</option>{(u.head_user_id===activeMe.user_id?students:committeeCandidates).filter(s=>!assignmentFor(s.user_id,'committee')&&personalMandates.some(a=>a.user_id===s.user_id&&a.base_mandates>0)).map(s=><option key={s.user_id} value={s.user_id}>{s.full_name}{s.team?' · '+s.team:''}</option>)}</select><button disabled={busy||!pick[u.id]} onClick={()=>void assign(u.id)}>Добавить</button></div>}
    </article>
   })}</div>
  </section>}

  {mode==='ministries'&&ministries.length>0&&<section className="staffingSection ministrySection">
   <div className="staffingSectionHead"><div><small>ПРАВИТЕЛЬСТВО</small><h3>5 министерств · беспартийный кадровый принцип</h3><p>Министры набирают заместителей и участников своих ведомств. Партийная принадлежность здесь не используется как критерий распределения; система показывает дисбаланс численности между ведомствами.</p></div><span className={maxCount-minCount>1?'warn':''}>разброс {minCount}–{maxCount}</span></div>
   <div className="ministryGrid">{ministries.map(u=>{
    const minister=ministers.find(n=>n.office_key==='ministry_'+u.unit_key);
    const aa=assignedTo(u.id),count=aa.length,balanced=count>=Number(u.capacity_min||3)&&count<=Number(u.capacity_max||5);
    return <article className={'institutionUnit ministryUnit '+(balanced?'balanced':'')} key={u.id}>
     <header><div><small>МИНИСТЕРСТВО</small><h4>{u.title}</h4><p>{u.description}</p></div><span>{count} / {u.capacity_min||3}–{u.capacity_max||5}</span></header>
     <div className="unitHead"><small>Министр · назначение этапа 9</small><b>{minister?.candidate_name||'Ещё не назначен'}</b>{!minister&&<span>Кандидатура и назначение находятся выше</span>}</div>
     <div className="unitMembers">{aa.length===0?<div className="emptyState">Ведомство пока не укомплектовано.</div>:aa.map(a=><div key={a.id}><span>{memberName(a.user_id)}</span><small>{a.assignment_role==='head'?'министр':'член министерства'}</small>{canManageMinistry(u)&&a.assignment_role!=='head'&&<IconAction variant="remove" onClick={()=>void remove(a.id)} label={'Исключить участника '+memberName(a.user_id)}/>}</div>)}</div>
     {canManageMinistry(u)&&minister&&<div className="unitAssign"><select aria-label={'Добавить сотрудника: '+u.title} value={pick[u.id]||''} onChange={e=>setPick(v=>({...v,[u.id]:e.target.value}))}><option value="">Добавить участника…</option>{students.filter(s=>!assignmentFor(s.user_id,'ministry')).map(s=><option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select><button disabled={busy||!pick[u.id]} onClick={()=>void assign(u.id)}>Добавить</button></div>}
    </article>
   })}</div>
  </section>}

  <footer className="staffingRule"><b>Правила модели</b><p>{mode==='committees'?'Пять комитетов по 90 мест; фракционные квоты пересчитываются по сохранённым мандатам. Один депутат состоит в одном комитете.':'Пять ведомств с ориентиром 3–5 человек. Один участник состоит в одном министерстве и может отдельно быть депутатом комитета ГД.'}</p></footer>
 </section>;
}
