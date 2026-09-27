'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Settings={game_id:string;system_type:'relative'|'absolute'|'qualified'|'preferential';threshold_pct:number;poll_enabled:boolean;status:'setup'|'round1'|'runoff'|'finished'|'manual_required';result:Record<string,any>};
type Candidate={id:string;user_id:string|null;party_id:string|null;display_name:string;nomination_type:'party'|'self'|'fictional';registration_status:'submitted'|'registered'|'revision'|'rejected'|'withdrawn';program_summary:string|null;registration_attempts:number;legal_error_count:number;rating_penalty:number};
type Score={candidate_id:string;round_no:1|2;teacher_program_pct:number|null;teacher_campaign_pct:number|null;game_rating_pct:number|null;poll_pct:number|null;teacher_runoff_pct:number|null;computed_pct:number|null};
type Draft={program:string;campaign:string;rating:string;poll:string;runoff:string};

const systemNames={relative:'Относительное большинство',absolute:'Абсолютное большинство',qualified:'Квалифицированное большинство',preferential:'Преференциальная'} as const;
const candidateStatus={submitted:'На проверке',registered:'Зарегистрирован',revision:'На доработке',rejected:'Отказано',withdrawn:'Снят'} as const;
const emptyDraft=():Draft=>({program:'',campaign:'',rating:'',poll:'',runoff:''});

export default function PresidentialElectionLab({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members,parties,currentStage,setError}=g;
 const [settings,setSettings]=useState<Settings|null>(null);
 const [candidates,setCandidates]=useState<Candidate[]>([]);
 const [scores,setScores]=useState<Score[]>([]);
 const [system,setSystem]=useState<Settings['system_type']>('absolute');
 const [threshold,setThreshold]=useState(50);
 const [pollEnabled,setPollEnabled]=useState(true);
 const [candidateUser,setCandidateUser]=useState('');
 const [candidateParty,setCandidateParty]=useState('');
 const [candidateName,setCandidateName]=useState('');
 const [program,setProgram]=useState('');
 const [review,setReview]=useState<Record<string,{status:Candidate['registration_status'];errors:string;penalty:string}>>({});
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [busy,setBusy]=useState(false);
 const ledParty=parties.find(p=>p.leader_user_id===me?.user_id);
 const canNominate=!!me&&(teacher||currentStage?.stage_no===6);

 async function load(){
  if(!game)return;
  const [a,b,c]=await Promise.all([
   supabase.from('presidential_election_settings').select('*').eq('game_id',game.id).maybeSingle(),
   supabase.from('presidential_candidates').select('*').eq('game_id',game.id).order('created_at'),
   supabase.from('presidential_scorecards').select('*').eq('game_id',game.id)
  ]);
  if(!a.error&&a.data){const x=a.data as Settings;setSettings(x);setSystem(x.system_type);setThreshold(Number(x.threshold_pct));setPollEnabled(x.poll_enabled)}
  if(!b.error){const rows=(b.data||[]) as Candidate[];setCandidates(rows);setReview(Object.fromEntries(rows.map(x=>[x.id,{status:x.registration_status,errors:String(x.legal_error_count),penalty:String(x.rating_penalty)}])))}
  if(!c.error){const rows=(c.data||[]) as Score[];setScores(rows);const next:Record<string,Draft>={};for(const x of rows)next[x.candidate_id+'-'+x.round_no]={program:String(x.teacher_program_pct??''),campaign:String(x.teacher_campaign_pct??''),rating:String(x.game_rating_pct??''),poll:String(x.poll_pct??''),runoff:String(x.teacher_runoff_pct??'')};setDrafts(v=>({...v,...next}))}
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('presidential-lab:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_election_settings',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_candidates',filter:'game_id=eq.'+game.id},()=>void load())
   .on('postgres_changes',{event:'*',schema:'public',table:'presidential_scorecards',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const score=(id:string,round:1|2)=>scores.find(x=>x.candidate_id===id&&x.round_no===round);
 const draft=(id:string,round:1|2)=>drafts[id+'-'+round]||emptyDraft();
 const setDraft=(id:string,round:1|2,key:keyof Draft,value:string)=>setDrafts(v=>({...v,[id+'-'+round]:{...emptyDraft(),...(v[id+'-'+round]||{}),[key]:value}}));
 const numberOrNull=(x:string)=>x.trim()===''?null:Number(x);
 const partyUsers=(partyId:string)=>{const p=parties.find(x=>x.id===partyId);return p?members.filter(m=>m.kind==='student'&&m.team===p.name):[]};

 async function configure(){setBusy(true);const r=await supabase.rpc('configure_presidential_election',{p_game_id:game.id,p_system_type:system,p_threshold_pct:threshold,p_poll_enabled:pollEnabled});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function nominate(){
  let type:'party'|'self'|'fictional'=teacher?(candidateParty?'party':candidateUser?'self':'fictional'):(ledParty?'party':'self');
  let partyId:string|null=teacher?(candidateParty||null):(ledParty?.id||null);
  let userId:string|null=teacher?(candidateUser||null):(ledParty?(candidateUser||me.user_id):me.user_id);
  const found=members.find(m=>m.user_id===userId);
  const name=(candidateName.trim()||found?.full_name||me.full_name).trim();
  setBusy(true);const r=await supabase.rpc('save_presidential_candidate',{p_game_id:game.id,p_candidate_id:null,p_user_id:userId,p_party_id:partyId,p_display_name:name,p_nomination_type:type,p_program_summary:program.trim()||null});
  if(r.error)setError(r.error.message);else{setCandidateName('');setCandidateUser('');setProgram('');await load()}setBusy(false)
 }
 async function reviewCandidate(id:string){const x=review[id];if(!x)return;setBusy(true);const r=await supabase.rpc('review_presidential_candidate',{p_candidate_id:id,p_status:x.status,p_legal_errors:Number(x.errors)||0,p_rating_penalty:Number(x.penalty)||0});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function saveScore(id:string,round:1|2){const x=draft(id,round);setBusy(true);const r=await supabase.rpc('set_presidential_scorecard',{p_candidate_id:id,p_round_no:round,p_teacher_program_pct:round===1?numberOrNull(x.program):null,p_teacher_campaign_pct:round===1?numberOrNull(x.campaign):null,p_game_rating_pct:round===1?numberOrNull(x.rating):null,p_poll_pct:round===1&&pollEnabled?numberOrNull(x.poll):null,p_teacher_runoff_pct:round===2?numberOrNull(x.runoff):null});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function finish(round:1|2){setBusy(true);const r=await supabase.rpc('finalize_presidential_round',{p_game_id:game.id,p_round_no:round});if(r.error)setError(r.error.message);else await load();setBusy(false)}

 return <section className="electionLab">
  <header className="electionLabHead"><div><small>ЭЛЕКТОРАЛЬНАЯ ЛАБОРАТОРИЯ · ЭТАПЫ 6–7</small><h2>Выборы Президента</h2><p>Все компоненты результата сохраняются отдельно: программа, агитация, игровой рейтинг, соцопрос и регистрационные штрафы.</p></div><div className="electionFormula"><b>1 тур</b><span>(программа + агитация + рейтинг{pollEnabled?' + опрос':''}) / {pollEnabled?'4':'3'} − штраф</span><b>2 тур</b><span>(результат 1 тура + новое голосование ППС) / 2</span></div></header>

  <div className="electionSettings"><div><small>СИСТЕМА</small><strong>{systemNames[settings?.system_type||system]}</strong><span>{settings?.system_type==='qualified'?'Порог '+settings.threshold_pct+'%':settings?.system_type==='preferential'?'Алгоритм подсчёта задаёт преподаватель':settings?.poll_enabled===false?'Без соцопроса':'Соцопрос включён'}</span></div>{teacher&&<div className="electionSettingsEdit"><select value={system} onChange={e=>setSystem(e.target.value as Settings['system_type'])}><option value="relative">Относительное большинство</option><option value="absolute">Абсолютное большинство</option><option value="qualified">Квалифицированное большинство</option><option value="preferential">Преференциальная</option></select>{system==='qualified'&&<input type="number" min="0" max="100" step="0.1" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/>}<label><input type="checkbox" checked={pollEnabled} onChange={e=>setPollEnabled(e.target.checked)}/> соцопрос</label><button disabled={busy} onClick={()=>void configure()}>Сохранить</button></div>}</div>

  {canNominate&&<details className="candidateNomination"><summary><div><b>Выдвинуть кандидата</b><span>Партия может иметь одного активного кандидата.</span></div><i>+</i></summary><div className="candidateNominationBody">{teacher&&<label>Партия<select value={candidateParty} onChange={e=>{setCandidateParty(e.target.value);setCandidateUser('')}}><option value="">Самовыдвижение / сценарный кандидат</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<label>Участник<select value={candidateUser} onChange={e=>setCandidateUser(e.target.value)}><option value="">{teacher?'Не привязывать к участнику':ledParty?'Выберите члена партии':'Я сам'}</option>{(teacher?(candidateParty?partyUsers(candidateParty):members.filter(m=>m.kind==='student')):ledParty?partyUsers(ledParty.id):[]).map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>{teacher&&<label>Имя в бюллетене<input value={candidateName} onChange={e=>setCandidateName(e.target.value)} placeholder="Для вымышленного кандидата обязательно"/></label>}<label className="candidateProgram">Краткая программа<textarea rows={4} value={program} onChange={e=>setProgram(e.target.value)} placeholder="Основные положения программы кандидата"/></label><button className="primary" disabled={busy||(!teacher&&!!ledParty&&!candidateUser)} onClick={()=>void nominate()}>Подать на регистрацию</button></div></details>}

  <div className="candidateGrid">{candidates.length===0?<div className="emptyState">Кандидаты ещё не выдвинуты.</div>:candidates.map(c=>{
   const d1=draft(c.id,1),d2=draft(c.id,2),s1=score(c.id,1),s2=score(c.id,2),party=parties.find(p=>p.id===c.party_id);
   const runoffIds=(settings?.result?.candidate_ids||[]) as string[];
   return <article className={'candidateCard '+c.registration_status} key={c.id}><header><div className="candidateAvatar">{c.display_name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()}</div><div><small>{party?.name||(c.nomination_type==='self'?'Самовыдвижение':'Сценарный кандидат')}</small><h3>{c.display_name}</h3></div><span>{candidateStatus[c.registration_status]}</span></header>{c.program_summary&&<p className="candidateProgramText">{c.program_summary}</p>}<div className="candidateAudit"><span>Подач <b>{c.registration_attempts}</b></span><span>Юр. ошибок <b>{c.legal_error_count}</b></span><span>Штраф <b>−{Number(c.rating_penalty).toFixed(1)} п.п.</b></span></div>
   {teacher&&<div className="candidateReview"><select value={review[c.id]?.status||c.registration_status} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{errors:'0',penalty:'0'}),status:e.target.value as Candidate['registration_status']}}))}><option value="submitted">На проверке</option><option value="registered">Зарегистрировать</option><option value="revision">Доработка</option><option value="rejected">Отказать</option><option value="withdrawn">Снять</option></select><label>ошибки<input type="number" min="0" value={review[c.id]?.errors||'0'} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{status:c.registration_status,penalty:'0'}),errors:e.target.value}}))}/></label><label>штраф<input type="number" min="0" step="0.1" value={review[c.id]?.penalty||'0'} onChange={e=>setReview(v=>({...v,[c.id]:{...(v[c.id]||{status:c.registration_status,errors:'0'}),penalty:e.target.value}}))}/></label><button disabled={busy} onClick={()=>void reviewCandidate(c.id)}>Зафиксировать</button></div>}
   {c.registration_status==='registered'&&<div className="candidateScores"><div className="candidateRound"><div className="candidateRoundTitle"><b>1 тур</b><strong>{s1?.computed_pct!=null?Number(s1.computed_pct).toFixed(2)+'%':'—'}</strong></div>{teacher&&<div className="scoreInputs"><label>Программа<input type="number" min="0" max="100" value={d1.program} onChange={e=>setDraft(c.id,1,'program',e.target.value)}/></label><label>Агитация<input type="number" min="0" max="100" value={d1.campaign} onChange={e=>setDraft(c.id,1,'campaign',e.target.value)}/></label><label>Рейтинг<input type="number" min="0" max="100" value={d1.rating} onChange={e=>setDraft(c.id,1,'rating',e.target.value)}/></label>{pollEnabled&&<label>Опрос<input type="number" min="0" max="100" value={d1.poll} onChange={e=>setDraft(c.id,1,'poll',e.target.value)}/></label>}<button disabled={busy} onClick={()=>void saveScore(c.id,1)}>Рассчитать</button></div>}</div>{settings?.status==='runoff'&&runoffIds.includes(c.id)&&<div className="candidateRound runoff"><div className="candidateRoundTitle"><b>2 тур</b><strong>{s2?.computed_pct!=null?Number(s2.computed_pct).toFixed(2)+'%':'—'}</strong></div>{teacher&&<div className="scoreInputs runoff"><label>Новое голосование ППС<input type="number" min="0" max="100" value={d2.runoff} onChange={e=>setDraft(c.id,2,'runoff',e.target.value)}/></label><button disabled={busy} onClick={()=>void saveScore(c.id,2)}>Рассчитать</button></div>}</div>}</div>}</article>
  })}</div>

  <footer className="electionResult"><div><small>ПРОТОКОЛ</small>{settings?.status==='finished'?<><h3>{String(settings.result?.winner||'Результат зафиксирован')}</h3><p>{settings.result?.score!=null?Number(settings.result.score).toFixed(2)+'%':''} · тур {settings.result?.round||'—'}</p></>:settings?.status==='runoff'?<><h3>Повторное голосование</h3><p>Второй тур для двух лидеров первого тура.</p></>:settings?.status==='manual_required'?<><h3>Ручной подсчёт</h3><p>Для преференциальной модели авторские правила не задают алгоритм перераспределения предпочтений.</p></>:<><h3>Ожидает расчёта</h3><p>Заполните компоненты рейтинга зарегистрированных кандидатов.</p></>}</div>{teacher&&<div>{settings?.status==='runoff'?<button className="primary" disabled={busy} onClick={()=>void finish(2)}>Завершить 2 тур</button>:settings?.status!=='finished'&&<button className="primary" disabled={busy} onClick={()=>void finish(1)}>Завершить 1 тур</button>}</div>}</footer>
 </section>;
}
