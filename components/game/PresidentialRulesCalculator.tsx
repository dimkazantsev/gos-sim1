'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './StageForms.module.css';

type Candidate={id:string;user_id:string|null;display_name:string};
type Settings={system_type:string;threshold_pct:number;poll_enabled:boolean;status:string;result:Record<string,any>};
type Ballot={round_no:number;criterion:string;slot_no:number;candidate_id:string};
type Row={candidate_id:string;name:string;points:number;program_pct:number;campaign_pct:number;game_pct:number;poll_pct:number|null;penalty:number;modifier:number;first_pct:number|null;teacher_runoff_pct:number;result_pct:number|null};
type Calculation={ready:boolean;issues:string[];rows:Row[];jury_size:number;total_points:number;poll_enabled:boolean};
const names:Record<string,string>={relative:'Относительное большинство',absolute:'Абсолютное большинство',qualified:'Квалифицированное большинство',preferential:'Преференциальная система'};
const pct=(value:number|null|undefined)=>value==null?'—':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:4})+'%';

export default function PresidentialRulesCalculator({g,candidates,settings,onSaved}:{g:ReturnTypeRepublic;candidates:Candidate[];settings:Settings|null;onSaved:()=>Promise<void>}){
 const [calculation,setCalculation]=useState<Calculation|null>(null),[ballots,setBallots]=useState<Ballot[]>([]),[busy,setBusy]=useState(false),[size,setSize]=useState('8');
 const [drafts,setDrafts]=useState<Record<string,{points:string;poll:string}>>({}),[notice,setNotice]=useState('');
 const sequence=useRef(0),dirty=useRef(new Set<string>()),versions=useRef(new Map<string,number>()),sizeDirty=useRef(false),alive=useRef(true),busyRef=useRef(false);
 const round=settings?.status==='runoff'||settings?.result?.round===2?2:1;
 const scope=[g.game?.id,g.me?.user_id,g.teacher,settings?.status,round].join('|'),liveScope=useRef(scope);liveScope.current=scope;
 const active=()=>alive.current&&scope===liveScope.current;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;busyRef.current=false}},[]);
 useEffect(()=>{sequence.current++;dirty.current.clear();versions.current.clear();sizeDirty.current=false;busyRef.current=false;setDrafts({});setCalculation(null);setBallots([]);setSize('8');setBusy(false);setNotice('')},[scope]);
 async function load(){
  if(!active()||!g.game||!g.teacher)return;const ticket=++sequence.current;
  const [r,b]=await Promise.all([supabase.rpc('get_presidential_rules_calculation',{p_game_id:g.game.id,p_round_no:round}),supabase.from('presidential_teacher_ballots').select('round_no,criterion,slot_no,candidate_id').eq('game_id',g.game.id)]);
  if(ticket!==sequence.current||!active())return;
  if(r.error||b.error){g.setError(r.error||b.error);return;}
  const next=r.data as Calculation;setCalculation(next);setBallots((b.data||[]) as Ballot[]);if(!sizeDirty.current)setSize(String(next.jury_size||8));
  setDrafts(old=>{const copy={...old};for(const x of next.rows)if(!dirty.current.has(x.candidate_id))copy[x.candidate_id]={points:String(x.points??0),poll:String(x.poll_pct??'')};return copy;});
 }
 useGameTableSync(g.game?.id,['presidential_teacher_ballots','presidential_scorecards','presidential_election_settings','presidential_candidates','game_members','game_parties'],load,scope);
 if(!g.teacher||!g.game)return null;
 if(settings?.status==='finished'&&settings.result?.rules_version!==2)return <section className={styles.panel}><h3>Расчёт завершённых выборов</h3><p>Сохранённый исторический результат доступен во вкладке итогов. Новая формула применяется к незавершённым выборам; завершённая процедура сохраняет свой протокол.</p></section>;
 const locked=!settings||['finished','manual_required'].includes(settings.status);
 const eligible=candidates.filter(c=>c.user_id&&(round===1||Array.isArray(settings?.result?.candidate_ids)&&settings!.result.candidate_ids.includes(c.id)));
 async function run(name:string,args:Record<string,unknown>){
  if(!active()||!g.teacher||!g.game||busyRef.current)return false;busyRef.current=true;setBusy(true);
  try{const r=await supabase.rpc(name,args);if(!active())return false;if(r.error){g.setError(r.error);return false;}await onSaved();if(!active())return false;await load();return active();}
  catch(error){if(active())g.setError(error);return false;}
  finally{if(active()){busyRef.current=false;setBusy(false);}}
 }
 async function saveInputs(id:string){
  if(!active())return;
  const d=drafts[id];if(!d||!Number.isFinite(Number(d.points))||d.points.trim()===''){g.setError('Введите баллы кандидата.');return;}
  const version=versions.current.get(id);
  const ok=await run('set_presidential_rules_input',{p_candidate_id:id,p_game_points:Number(d.points),p_poll_pct:d.poll.trim()===''?null:Number(d.poll)});
  if(ok&&versions.current.get(id)===version){dirty.current.delete(id);setNotice('Баллы и доля опроса сохранены.');}
 }
 return <section className={styles.panel} aria-label="Калькулятор ЦИК по авторским правилам">
  <div className={styles.sectionHead}><div><h3>Расчёт президентских выборов</h3><p>Только преподаватель · {settings?names[settings.system_type]:'Система ещё не утверждена'}</p></div><span className={styles.pill}>{round===1?'Первый тур':'Второй тур'}</span></div>
  <div className={styles.formula}><strong>{round===1?(settings?.poll_enabled===false?'(Программа ППС + Агитация ППС + Рейтинг игры) / 3':'(Программа ППС + Агитация ППС + Рейтинг игры + Соцопрос) / 4'):'(Итог первого тура + Повторное голосование ППС) / 2'}</strong><p>{round===1?'ППС: доля голосов за кандидата от всего состава преподавателей. Рейтинг игры: баллы кандидата / сумма баллов всех кандидатов × 100. После среднего применяются штрафы ЦИК и показанный партийный модификатор.':'Первый тур сохраняется без преобразования в проценты двух финалистов. Новый опрос ППС проводится отдельно; повторные программа, агитация и соцопрос в формулу не добавляются. Побеждает наибольший итог; равенство требует нового решения ЦИК.'}</p></div>
  {notice&&<p className={styles.notice} role="status">{notice}</p>}
  {!settings?<p className={styles.notice}>Сначала утвердите систему выборов на этапе 6.</p>:<>
   <div className={styles.grid}><label className={styles.field}>Число голосующих преподавателей<input type="number" min="1" max="50" value={size} disabled={busy||locked||round===2} onChange={e=>{sizeDirty.current=true;setSize(e.target.value)}}/></label>{round===1&&<div className={styles.actions}><button type="button" disabled={busy||locked||!Number.isInteger(Number(size))||Number(size)<1||Number(size)>50} onClick={()=>void (async()=>{if(await run('set_presidential_jury_size',{p_game_id:g.game!.id,p_size:Number(size)}))sizeDirty.current=false})()}>Сохранить состав ППС</button></div>}</div>
   {!locked&&<section className={styles.section}><h3>{round===1?'Голоса преподавателей':'Повторные голоса преподавателей'}</h3><p>Для каждого преподавателя выберите одного кандидата в каждом голосовании. Состав фиксируется перед первым туром.</p><div className={styles.rows}>{Array.from({length:calculation?.jury_size||8},(_,i)=>i+1).map(slot=><div className={styles.row} key={slot}><b>Преподаватель {slot}</b><div className={styles.grid}>{(round===1?['program','campaign']:['runoff']).map(criterion=><StyledSelect wrap key={criterion} label={criterion==='program'?'Программа и документы':criterion==='campaign'?'Агитация':'Повторное голосование'} value={ballots.find(x=>x.round_no===round&&x.slot_no===slot&&x.criterion===criterion)?.candidate_id||''} disabled={busy} onChange={candidate=>void run('set_presidential_teacher_ballot',{p_game_id:g.game!.id,p_round_no:round,p_criterion:criterion,p_slot_no:slot,p_candidate_id:candidate||null})} options={[{value:'',label:'Голос не внесён'},...eligible.map(c=>({value:c.id,label:c.display_name}))]}/>)}</div></div>)}</div></section>}
   <section className={styles.section}><h3>Компоненты и итог каждого кандидата</h3><div className={styles.rows}>{calculation?.rows.map(x=><article className={styles.row} key={x.candidate_id}><h3>{x.name}</h3><div className={styles.statList}>{round===1?<><div><span>Голоса за программу</span><strong>{pct(x.program_pct)}</strong></div><div><span>Голоса за агитацию</span><strong>{pct(x.campaign_pct)}</strong></div><div><span>Доля баллов игры</span><strong>{pct(x.game_pct)}</strong></div>{settings.poll_enabled&&<div><span>Соцопрос</span><strong>{pct(x.poll_pct)}</strong></div>}</>:<><div><span>Первый тур, без пересчёта</span><strong>{pct(x.first_pct)}</strong></div><div><span>Повторные голоса ППС</span><strong>{pct(x.teacher_runoff_pct)}</strong></div></>}<div><span>Итог {calculation.ready?'':'· Предварительный'}</span><strong>{pct(x.result_pct)}</strong></div></div>{round===1&&<><p>Штраф ЦИК: −{Number(x.penalty||0).toLocaleString('ru-RU')} п.п. · Партийный модификатор: {Number(x.modifier||0)>0?'+':''}{Number(x.modifier||0).toLocaleString('ru-RU')} п.п.</p>{!locked&&<div className={styles.grid}><label className={styles.field}>Баллы в игре<input type="number" min="0" step="0.01" value={drafts[x.candidate_id]?.points??''} disabled={busy} onChange={e=>{dirty.current.add(x.candidate_id);versions.current.set(x.candidate_id,(versions.current.get(x.candidate_id)||0)+1);setDrafts(v=>({...v,[x.candidate_id]:{...v[x.candidate_id],points:e.target.value}}));}}/></label>{settings.poll_enabled&&<label className={styles.field}>Доля соцопроса, %<input type="number" min="0" max="100" step="0.01" value={drafts[x.candidate_id]?.poll??''} disabled={busy} onChange={e=>{dirty.current.add(x.candidate_id);versions.current.set(x.candidate_id,(versions.current.get(x.candidate_id)||0)+1);setDrafts(v=>({...v,[x.candidate_id]:{...v[x.candidate_id],poll:e.target.value}}));}}/></label>}<div className={styles.actions}><button disabled={busy} onClick={()=>void saveInputs(x.candidate_id)}>Сохранить значения</button></div></div>}</>}</article>)}</div></section>
   {(calculation?.issues.length??0)>0&&<div className={styles.notice} role="status"><b>До фиксации результата</b><ul>{calculation?.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></div>}
   {settings.result?.tie&&<p className={styles.notice}>{settings.result.reason}</p>}
   {settings.system_type==='absolute'&&<p>Победа в первом туре требует строго более 50%. Ровно 50% означает второй тур. Порог проверяется до округления.</p>}
   {settings.system_type==='qualified'&&<p>Утверждённый порог первого тура: {settings.threshold_pct}%. Если он не достигнут, объявляется второй тур.</p>}
   {settings.system_type==='preferential'&&<p>Для этой системы нужны ранжированные бюллетени и отдельный подсчёт ЦИК; формула среднего не объявляет победителя автоматически.</p>}
   {!locked&&<div className={styles.actions}><button className="primary" disabled={busy||!calculation?.ready||dirty.current.size>0} onClick={()=>void run('finalize_presidential_round',{p_game_id:g.game!.id,p_round_no:round})}>Зафиксировать итог {round===1?'первого':'второго'} тура</button></div>}
  </>}
 </section>;
}
