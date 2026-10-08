'use client';
import {IconAction} from '../ui/IconAction';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import {stageRoleTitles} from './stageRoles';
import type {ReturnTypeRepublic} from './viewTypes';
import CommitteeChairElectionPanel from './CommitteeChairElectionPanel';

type Unit={id:string;game_id:string;unit_kind:'committee'|'ministry';unit_key:string;title:string;description:string|null;capacity_min:number|null;capacity_max:number|null;mandate_capacity:number|null;head_user_id:string|null};
type Assignment={id:string;game_id:string;unit_id:string;unit_kind:'committee'|'ministry';user_id:string;party_id:string|null;assignment_role:'member'|'deputy'|'head';created_at:string};
type Matrix={unit_id:string;title:string;party_id:string;party_name:string;color:string;quota:number;students:number};

export default function InstitutionStaffingLab({g,mode}:{g:ReturnTypeRepublic;mode:'committees'|'ministries'}){
 const {game,me,teacher,members,parties,setError}=g;
 const [units,setUnits]=useState<Unit[]>([]);
 const [assignments,setAssignments]=useState<Assignment[]>([]);
 const [matrix,setMatrix]=useState<Matrix[]>([]);
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
   if(ready.error){setLoadError(ready.error.message);setLoaded(true);return;}
  }
  const [u,a,m]=await Promise.all([
   supabase.from('institution_units').select('*').eq('game_id',game.id).order('unit_kind').order('unit_key'),
   supabase.from('institution_assignments').select('*').eq('game_id',game.id).order('created_at'),
   mode==='committees'?supabase.rpc('get_committee_matrix',{p_game_id:game.id}):Promise.resolve({data:[],error:null})
  ]);
  const failure=[u,a,m].find(x=>x.error);setLoaded(true);if(failure?.error){setLoadError(failure.error.message);return;}setLoadError('');
  if(!u.error)setUnits((u.data||[]) as Unit[]);
  if(!a.error)setAssignments((a.data||[]) as Assignment[]);
  if(!m.error)setMatrix((m.data||[]) as Matrix[]);
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
  if(r.error)setError(r.error.message);else{setPick(v=>({...v,[unitId]:''}));await load()}setBusy(false);
 }
 async function remove(id:string){setBusy(true);const r=await supabase.rpc('remove_institution_member',{p_assignment_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function createCommittees(){setBusy(true);const r=await supabase.rpc('ensure_duma_committees',{p_game_id:game!.id});if(r.error)setError(r.error.message);else await load();setBusy(false)}

 const ministryCounts=ministries.map(u=>assignedTo(u.id).length);
 const minCount=ministryCounts.length?Math.min(...ministryCounts):0;
 const maxCount=ministryCounts.length?Math.max(...ministryCounts):0;

 return <section className="staffingLab" data-staffing={mode}>
  <header className="staffingLabHead">
   <div><h2>{mode==='committees'?'Комитеты Государственной Думы':'Команды министерств'}</h2><p>{mode==='committees'?'На первом заседании палата образует пять комитетов. Фракции распределяют депутатов, затем Государственная Дума избирает председателей.':'Министры, назначенные на этапе 8, набирают сотрудников своих ведомств. Участник может состоять только в одном министерстве; партийная принадлежность не определяет распределение.'}</p></div>
   <div className="staffingBalance"><strong>{assignments.filter(a=>a.unit_kind===(mode==='committees'?'committee':'ministry')).length}</strong><span>{mode==='committees'?'в комитетах':'в министерствах'}</span></div>
  </header>
  {loadError&&<div className="stageOperationsNotice" role="alert"><p>{loadError}</p><button type="button" onClick={()=>void load()}>Повторить загрузку</button></div>}
  {!loaded&&<p role="status">Загрузка состава…</p>}
  {mode==='committees'&&loaded&&!loadError&&committees.length<5&&<div className="stageOperationsActionBar"><p>Создайте пять комитетов по направлениям, заданным правилами игры. Уже существующие составы и результаты выборов сохраняются.</p>{canCreateCommittees?<button type="button" className="primary" disabled={busy} onClick={()=>void createCommittees()}>Создать комитеты ГД</button>:<span>Создание доступно Председателю, Совету ГД и преподавателю.</span>}</div>}
  {mode==='ministries'&&loaded&&!loadError&&!ministries.length&&<p className="stageOperationsNotice">Сначала утвердите структуру Правительства на этапе 8. После этого здесь появятся ведомства.</p>}

  {mode==='committees'&&committees.length>0&&<section className="staffingSection">
   <div className="staffingSectionHead"><div><small>ГОСУДАРСТВЕННАЯ ДУМА</small><h3>5 комитетов · пропорциональное представительство фракций</h3><p>Каждый комитет моделирует 90 депутатских мест. Квота партии автоматически пересчитывается из текущего распределения мандатов ГД; студенты внутри своей фракционной квоты представляют соответствующую долю депутатов.</p></div><span>1 студент → 1 комитет</span></div>
   <div className="committeeGrid">{committees.map(u=>{
    const aa=assignedTo(u.id),rows=committeeRows(u.id);
    return <article className="institutionUnit committeeUnit" key={u.id}>
     <header><div><small>КОМИТЕТ</small><h4>{u.title}</h4><p>{u.description}</p></div><span>{aa.length} студентов</span></header>
     <div className="committeeQuota">{rows.map(r=><div key={r.party_id}><i style={{background:r.color}}/><b>{r.party_name}</b><strong>{r.quota}</strong><span>{r.students} студент(а)</span></div>)}</div>
     <div className="unitHead"><small>ПРЕДСЕДАТЕЛЬ</small><b>{memberName(u.head_user_id)}</b><span className="unitHeadElectionHint">Избирается всей Государственной Думой ниже</span></div>
     <div className="unitMembers">{aa.length===0?<div className="emptyState">Состав не сформирован.</div>:aa.map(a=>{const row=rows.find(r=>r.party_id===a.party_id);const partyStudents=Math.max(1,row?.students||1);const weight=(row?.quota||0)/partyStudents;return <div key={a.id}><span>{memberName(a.user_id)}</span><small>{partyName(a.party_id)}</small><b>≈ {weight.toFixed(1)} мандата</b>{canManageCommittee&&(!ledParty||a.party_id===ledParty.id||teacher)&&<IconAction variant="remove" onClick={()=>void remove(a.id)} label={'Исключить участника '+memberName(a.user_id)}/>}</div>})}</div>
     {canManageCommittee&&<div className="unitAssign"><select aria-label={'Добавить депутата: '+u.title} value={pick[u.id]||''} onChange={e=>setPick(v=>({...v,[u.id]:e.target.value}))}><option value="">Добавить депутата…</option>{committeeCandidates.filter(s=>!assignmentFor(s.user_id,'committee')).map(s=><option key={s.user_id} value={s.user_id}>{s.full_name}{s.team?' · '+s.team:''}</option>)}</select><button disabled={busy||!pick[u.id]} onClick={()=>void assign(u.id)}>Добавить</button></div>}
    </article>
   })}</div>
  </section>}

  {mode==='committees'&&committees.length>0&&<CommitteeChairElectionPanel g={g}/>}

  {mode==='ministries'&&ministries.length>0&&<section className="staffingSection ministrySection">
   <div className="staffingSectionHead"><div><small>ПРАВИТЕЛЬСТВО</small><h3>5 министерств · беспартийный кадровый принцип</h3><p>Министры набирают заместителей и участников своих ведомств. Партийная принадлежность здесь не используется как критерий распределения; система показывает дисбаланс численности между ведомствами.</p></div><span className={maxCount-minCount>1?'warn':''}>разброс {minCount}–{maxCount}</span></div>
   <div className="ministryGrid">{ministries.map(u=>{
    const aa=assignedTo(u.id),count=aa.length,balanced=count>=Number(u.capacity_min||3)&&count<=Number(u.capacity_max||5);
    return <article className={'institutionUnit ministryUnit '+(balanced?'balanced':'')} key={u.id}>
     <header><div><small>МИНИСТЕРСТВО</small><h4>{u.title}</h4><p>{u.description}</p></div><span>{count} / {u.capacity_min||3}–{u.capacity_max||5}</span></header>
     <div className="unitHead"><small>МИНИСТР · НАЗНАЧЕНИЕ ЭТАПА 8</small><b>{memberName(u.head_user_id)}</b></div>
     <div className="unitMembers">{aa.length===0?<div className="emptyState">Ведомство пока не укомплектовано.</div>:aa.map(a=><div key={a.id}><span>{memberName(a.user_id)}</span><small>{a.assignment_role==='head'?'министр':'член министерства'}</small>{canManageMinistry(u)&&a.assignment_role!=='head'&&<IconAction variant="remove" onClick={()=>void remove(a.id)} label={'Исключить участника '+memberName(a.user_id)}/>}</div>)}</div>
     {canManageMinistry(u)&&u.head_user_id&&<div className="unitAssign"><select aria-label={'Добавить сотрудника: '+u.title} value={pick[u.id]||''} onChange={e=>setPick(v=>({...v,[u.id]:e.target.value}))}><option value="">Добавить участника…</option>{students.filter(s=>!assignmentFor(s.user_id,'ministry')).map(s=><option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select><button disabled={busy||!pick[u.id]} onClick={()=>void assign(u.id)}>Добавить</button></div>}
    </article>
   })}</div>
  </section>}

  <footer className="staffingRule"><b>Правила модели</b><p>{mode==='committees'?'Пять комитетов по 90 мест; фракционные квоты пересчитываются по сохранённым мандатам. Один депутат состоит в одном комитете.':'Пять ведомств с ориентиром 3–5 человек. Один участник состоит в одном министерстве и может отдельно быть депутатом комитета ГД.'}</p></footer>
 </section>;
}
