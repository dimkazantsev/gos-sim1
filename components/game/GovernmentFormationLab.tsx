'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Nomination={
 id:string;game_id:string;office_key:string;office_title:string;
 office_kind:'prime_minister'|'deputy_pm'|'duma_minister'|'security_minister'|'central_bank_chair';
 route:'president_to_duma'|'pm_to_duma'|'president_after_sf';
 candidate_user_id:string|null;candidate_name:string;attempt_no:number;
 status:'submitted'|'vote_open'|'approved'|'rejected'|'consultation_pending'|'consulted'|'appointed'|'withdrawn';
 vote_id:string|null;note:string|null;created_at:string;decided_at:string|null;appointed_at:string|null
};

const routeLabel:Record<Nomination['route'],string>={
 president_to_duma:'Президент → Государственная Дума → Президент',
 pm_to_duma:'Председатель Правительства → Государственная Дума → Президент',
 president_after_sf:'Президент → консультации с Советом Федерации → назначение'
};
const statusLabel:Record<Nomination['status'],string>={
 submitted:'Внесена',vote_open:'Голосование открыто',approved:'Утверждена ГД',rejected:'Отклонена ГД',
 consultation_pending:'Ожидает консультации СФ',consulted:'Консультация проведена',appointed:'Назначен(а)',withdrawn:'Отозвана'
};

export default function GovernmentFormationLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,votes,setError}=g;
 const [rows,setRows]=useState<Nomination[]>([]);
 const [kind,setKind]=useState<Nomination['office_kind']>('prime_minister');
 const [officeTitle,setOfficeTitle]=useState('Председатель Правительства Российской Федерации');
 const [candidate,setCandidate]=useState('');
 const [candidateName,setCandidateName]=useState('');
 const [consultNote,setConsultNote]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const role=(me?.role_title||'').toLowerCase();
 const isPresident=role.includes('президент');
 const isPM=role.includes('председател')&&role.includes('правительств');
 const canSubmit=teacher||isPresident||isPM;

 async function load(){
  if(!game)return;
  const r=await supabase.from('government_nominations').select('*').eq('game_id',game.id).eq('stage_no',8).order('created_at',{ascending:true});
  if(!r.error)setRows((r.data||[]) as Nomination[]);
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('government-formation:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'government_nominations',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const activeGame=game;
 const candidateMember=members.find(m=>m.user_id===candidate);
 const rejections=(officeKey:string)=>rows.filter(r=>r.office_key===officeKey&&r.status==='rejected').length;
 const voteInfo=(id:string|null)=>id?votes.find(v=>v.id===id):undefined;

 function chooseKind(x:Nomination['office_kind']){
  setKind(x);
  setOfficeTitle(
   x==='prime_minister'?'Председатель Правительства Российской Федерации':
   x==='central_bank_chair'?'Председатель Центрального банка Российской Федерации':
   x==='deputy_pm'?'Заместитель Председателя Правительства Российской Федерации':
   x==='security_minister'?'Федеральный министр блока ст. 83 «д.1»':
   'Федеральный министр'
  );
 }

 async function submit(){
  const name=(candidateName.trim()||candidateMember?.full_name||'').trim();
  if(name.length<3||officeTitle.trim().length<3)return;
  const base=kind==='prime_minister'?'prime_minister':kind==='central_bank_chair'?'central_bank_chair':kind+'_'+officeTitle.trim().toLowerCase().replace(/[^а-яa-z0-9]+/gi,'_').slice(0,36);
  setBusy(true);
  const r=await supabase.rpc('submit_government_nomination',{
   p_game_id:activeGame.id,p_office_key:base,p_office_title:officeTitle.trim(),
   p_office_kind:kind,p_candidate_user_id:candidate||null,p_candidate_name:name
  });
  if(r.error)setError(r.error.message);else{setCandidate('');setCandidateName('');await load()}
  setBusy(false);
 }
 async function openVote(id:string){setBusy(true);const r=await supabase.rpc('open_government_nomination_vote',{p_nomination_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function consult(id:string){setBusy(true);const r=await supabase.rpc('record_sf_consultation',{p_nomination_id:id,p_note:(consultNote[id]||'').trim()||null});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function appoint(id:string){setBusy(true);const r=await supabase.rpc('appoint_government_nominee',{p_nomination_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}

 return <section className="governmentLab">
  <header className="governmentLabHead">
   <div><small>ФОРМИРОВАНИЕ ИСПОЛНИТЕЛЬНОЙ ВЛАСТИ · ЭТАП 8</small><h2>Конструктор Правительства</h2><p>Система разделяет субъект внесения кандидатуры, парламентское утверждение, консультации с Советом Федерации и окончательное назначение. Игровые сокращения помечаются отдельно от действующей конституционной процедуры.</p></div>
   <div className="governmentRoutes"><span><b>111</b> Председатель Правительства</span><span><b>112</b> Заместители и большинство министров</span><span><b>83 д.1</b> силовой/внешнеполитический блок</span></div>
  </header>

  {canSubmit&&<details className="governmentNominate">
   <summary><div><b>Внести кандидатуру</b><span>Сервер проверит, соответствует ли ваша игровая роль субъекту представления.</span></div><i>+</i></summary>
   <div className="governmentNominateGrid">
    <label>Тип должности<select value={kind} onChange={e=>chooseKind(e.target.value as Nomination['office_kind'])}>
     <option value="prime_minister">Председатель Правительства</option>
     <option value="deputy_pm">Заместитель Председателя Правительства</option>
     <option value="duma_minister">Министр, утверждаемый ГД</option>
     <option value="security_minister">Министр блока ст. 83 «д.1»</option>
     <option value="central_bank_chair">Председатель Банка России · игровая процедура</option>
    </select></label>
    <label>Должность<input value={officeTitle} onChange={e=>setOfficeTitle(e.target.value)}/></label>
    <label>Участник<select value={candidate} onChange={e=>setCandidate(e.target.value)}><option value="">Сценарная кандидатура / имя вручную</option>{members.filter(m=>m.kind==='student').map(m=><option key={m.user_id} value={m.user_id}>{m.full_name} · {m.role_title||'участник'}</option>)}</select></label>
    <label>Имя кандидатуры<input value={candidateName} onChange={e=>setCandidateName(e.target.value)} placeholder={candidateMember?.full_name||'Ф.И.О. кандидата'}/></label>
    <button className="primary" disabled={busy||(!candidate&&candidateName.trim().length<3)} onClick={()=>void submit()}>Внести кандидатуру</button>
   </div>
  </details>}

  <div className="governmentFlow">
   {rows.length===0?<div className="emptyState">Кандидатуры ещё не внесены.</div>:rows.map(n=>{
    const v=voteInfo(n.vote_id),rejects=rejections(n.office_key),canAppoint=teacher||isPresident;
    return <article className={'governmentNomination '+n.status} key={n.id}>
     <header><div><small>{routeLabel[n.route]}</small><h3>{n.office_title}</h3><p>{n.candidate_name}</p></div><span>{statusLabel[n.status]}</span></header>
     <div className="governmentAudit">
      <span>Попытка <b>{n.attempt_no}/3</b></span>
      {n.route!=='president_after_sf'&&<span>Отклонений по должности <b>{rejects}</b></span>}
      {v&&<span>Голосование <b>{v.status==='open'?'открыто':v.result_label||'закрыто'}</b></span>}
     </div>

     <div className="governmentProcedure">
      {n.route==='president_to_duma'&&<><b>1</b><span>Президент внёс кандидатуру</span><b>2</b><span>ГД утверждает большинством от общего числа депутатов</span><b>3</b><span>Президент назначает утверждённого кандидата</span></>}
      {n.route==='pm_to_duma'&&<><b>1</b><span>Председатель Правительства внёс кандидатуру</span><b>2</b><span>ГД утверждает большинством от общего числа депутатов</span><b>3</b><span>Президент назначает утверждённого кандидата</span></>}
      {n.route==='president_after_sf'&&<><b>1</b><span>Определена кандидатура специального министра</span><b>2</b><span>Проводятся консультации с Советом Федерации</span><b>3</b><span>Президент принимает решение о назначении</span></>}
     </div>

     {teacher&&n.status==='submitted'&&<button className="primary governmentAction" disabled={busy} onClick={()=>void openVote(n.id)}>Открыть голосование ГД →</button>}
     {teacher&&n.status==='consultation_pending'&&<div className="sfConsult"><textarea rows={2} value={consultNote[n.id]||''} onChange={e=>setConsultNote(x=>({...x,[n.id]:e.target.value}))} placeholder="Краткий итог консультаций с Советом Федерации"/><button disabled={busy} onClick={()=>void consult(n.id)}>Зафиксировать консультацию</button></div>}
     {canAppoint&&(n.status==='approved'||n.status==='consulted')&&<button className="primary governmentAction" disabled={busy} onClick={()=>void appoint(n.id)}>Назначить на должность</button>}
     {n.status==='rejected'&&rejects>=3&&<div className="governmentConstitutionAlert"><b>Третье отклонение</b><p>{n.office_kind==='prime_minister'?'Активируется развилка ч. 4 ст. 111 Конституции РФ: назначение Председателя Правительства Президентом и возможность роспуска ГД с назначением новых выборов.':'Для членов Правительства применяются последствия ч. 4 ст. 112; вопрос о роспуске ГД зависит от числа оставшихся вакансий.'}</p></div>}
    </article>
   })}
  </div>

  <footer className="governmentLegalNote"><b>Что является учебной редукцией</b><p>В исходной игре Совет Федерации в ряде процедур моделируется преподавателем. Здесь это сохранено как отдельный шаг «консультация СФ», но субъект внесения кандидатур и последовательность назначения приведены в соответствие с действующими статьями 83, 111 и 112 Конституции РФ.</p></footer>
 </section>;
}
