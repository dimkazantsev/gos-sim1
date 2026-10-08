'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
import {programMoney} from './stateProgramModel';
import styles from './StageForms.module.css';
type SignedProgram={id:string;title:string;ministry:string;total_budget:number|string;program_status:string;signed_at:string;years:{year:number;amount:number|string;status:'planned'|'approved'|'rejected'}[]};
export default function SignedProgramBudget({g,onOpenStage}:{g:ReturnTypeRepublic;onOpenStage?:(stageNo:number)=>void}){
 const [programs,setPrograms]=useState<SignedProgram[]>([]),[ready,setReady]=useState(false);
 const sequence=useRef(0),scope=[g.game?.id,g.me?.user_id].join('|'),live=useRef(scope);live.current=scope;
 useEffect(()=>{sequence.current++;setPrograms([]);setReady(false)},[scope]);
 async function load(){if(!g.game)return;const version=++sequence.current,r=await supabase.rpc('get_signed_state_program_budget',{p_game_id:g.game.id});if(version!==sequence.current||live.current!==scope)return;if(r.error){g.setError(r.error);return;}setPrograms(r.data||[]);setReady(true)}
 useGameTableSync(g.game?.id,['state_programs','state_program_budget_commitments'],load,scope);
 return <section className={styles.panel} aria-label="Государственные программы в бюджете"><div className={styles.sectionHead}><div><h3>Государственные программы в бюджете</h3><p>Подписанные программы автоматически включаются в бюджетное планирование. Все суммы здесь указаны в рублях; бюджетные ассигнования утверждаются бюджетной процедурой.</p></div>{onOpenStage&&<button type="button" onClick={()=>onOpenStage(11)}>Открыть программы</button>}</div>
  {!ready?<p role="status">Загрузка программ…</p>:programs.length===0?<p>После подписи Председателя Правительства здесь появится программа и её финансирование по годам.</p>:programs.map(p=><article key={p.id} className={styles.row}><h3>{p.title}</h3><p>{p.ministry} · Подписана {new Date(p.signed_at).toLocaleDateString('ru-RU')}</p><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Год</th><th>Расходы, ₽</th><th>Решение Правительства</th></tr></thead><tbody>{(p.years||[]).map(y=><tr key={y.year}><td>{y.year}</td><td className={styles.number}>{programMoney(y.amount)}</td><td>{{planned:'Ожидает заседания',approved:'Программа принята',rejected:'Программа отклонена'}[y.status]}</td></tr>)}</tbody><tfoot><tr><th>Всего по программе</th><td className={styles.number}>{programMoney(p.total_budget)}</td><td/></tr></tfoot></table></div></article>)}
 </section>;
}
