'use client';
import {useEffect,useRef,useState} from 'react';
import {Landmark,ShieldCheck,Clock3} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
type Office={id:string;user_id:string;role_title:string;status:string;legal_basis:string;educational_exception:boolean;created_at:string};
const ROLES=['Депутат Государственной Думы','Председатель Государственной Думы','Председатель комитета Государственной Думы','Сенатор Совета Федерации','Президент Российской Федерации','Председатель Правительства Российской Федерации','Министр финансов','Министр экономики','Министр здравоохранения','Министр образования','Министр науки','Министр культуры','Министр транспорта','Министр труда','Министр энергетики','Министр цифрового развития','Министр иностранных дел','Министр внутренних дел','Министр чрезвычайных ситуаций','Министр природных ресурсов','Председатель Банка России','Глава муниципального образования','Глава городской администрации','Редактор СМИ','Председатель Счётной палаты','Судья','Председатель избирательной комиссии'];
export default function ProfileOffices({g,userId}:{g:ReturnTypeRepublic;userId:string}){
 const students=g.members.filter(m=>m.kind==='student');
 const initialTarget=students.some(m=>m.user_id===userId)?userId:g.teacher?students[0]?.user_id||'':userId;
 const [targetId,setTargetId]=useState(initialTarget),[offices,setOffices]=useState<Office[]>([]),[role,setRole]=useState(ROLES[0]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const request=useRef(0);
 const target=g.members.find(m=>m.user_id===targetId),active=offices.filter(o=>o.status==='active');
 const current=active.find(o=>o.role_title===target?.role_title);
 const canInitiate=g.teacher||/президент|председатель.*правительств|глава/i.test(g.me?.role_title||'');
 const canSwitch=g.teacher||targetId===g.me?.user_id;
 async function load(){
  const token=++request.current;
  if(!g.game||!targetId){setOffices([]);return}
  const r=await supabase.from('game_office_assignments').select('*').eq('game_id',g.game.id).eq('user_id',targetId).neq('status','ended').order('created_at');
  if(token!==request.current)return;
  if(r.error)setNotice(r.error.message);else setOffices((r.data||[]) as Office[]);
 }
 useEffect(()=>{setTargetId(initialTarget);setNotice('')},[userId,g.teacher]);
 useEffect(()=>{if(g.teacher&&!students.some(m=>m.user_id===targetId))setTargetId(students[0]?.user_id||'')},[g.members,targetId,g.teacher]);
 useEffect(()=>{setOffices([]);void load();return()=>{request.current++}},[g.game?.id,targetId,g.members]);
 async function appoint(){
  if(!g.game||busy||!target||target.kind!=='student'||role.trim().length<2)return;
  setBusy(true);setNotice('');
  const r=await supabase.rpc('appoint_game_office',{p_game:g.game.id,p_user:targetId,p_role:role.trim(),p_basis:g.teacher?'Учебное назначение преподавателем; роли используются по очереди в малой группе':'Представление вышестоящего лица для учебной ротации',p_exception:g.teacher});
  setNotice(r.error?r.error.message:g.teacher?'Роль добавлена. Её можно выбрать как текущую.':'Представление направлено преподавателю.');
  if(!r.error)await Promise.all([load(),g.refresh()]);setBusy(false);
 }
 async function choose(id:string){
  if(busy||!id)return;setBusy(true);
  const r=await supabase.rpc('select_game_office',{p_id:id});
  setNotice(r.error?r.error.message:'Текущая роль изменена. Новые действия выполняются от её имени.');
  if(!r.error)await g.refresh();setBusy(false);
 }
 async function review(id:string,approve:boolean){
  if(busy)return;setBusy(true);
  const r=await supabase.rpc('review_game_office',{p_id:id,p_approve:approve});
  setNotice(r.error?r.error.message:approve?'Роль назначена.':'Роль снята.');
  if(!r.error)await Promise.all([load(),g.refresh()]);setBusy(false);
 }
 return <section className="profileOffices"><header><div><small>Роли в малой группе</small><h2>Игровые роли</h2></div><Landmark size={24}/></header>
  <p className="officeRoleExplanation">Преподаватель может назначить студенту роли, если их ещё никто не назначил. У студента может быть несколько доступных ролей: сегодня он действует как депутат, затем как министр. Для каждого действия используется одна текущая роль; уже принятые решения сохраняют роль на момент ответа.</p>
  {g.teacher&&<p className="officeRoleExplanation">Ваш статус — Преподаватель. Назначение и переключение студенческих ролей не ограничивает ваш административный доступ.</p>}
  {g.teacher&&<label className="officeStudentPicker">Студент<select aria-label="Студент для назначения роли" value={targetId} onChange={e=>{setTargetId(e.target.value);setNotice('')}}>{!students.length&&<option value="">В игре пока нет студентов</option>}{students.map(m=><option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></label>}
  {target?.kind==='student'&&<>
   <label className="officeCurrentRole">Текущая роль<select aria-label="Текущая игровая роль" value={current?.id||''} disabled={busy||!canSwitch||!active.length} onChange={e=>void choose(e.target.value)}>{!current&&<option value="">{target.role_title||'Роль не выбрана'}</option>}{active.map(o=><option value={o.id} key={o.id}>{o.role_title}</option>)}</select></label>
   <div className="officeCards">{offices.map(o=><article key={o.id} className={o.status==='pending'?'pending':''}><span className="officeIcon">{o.status==='active'?<ShieldCheck/>:<Clock3/>}</span><div><h3>{o.role_title}</h3><p>{o.status==='pending'?'Ожидает утверждения':o.id===current?.id?'Текущая роль':'Доступна для переключения'}</p></div>{g.teacher&&<div className="officeActions">{o.status==='pending'&&<button disabled={busy} onClick={()=>void review(o.id,true)}>Назначить</button>}<button disabled={busy} onClick={()=>void review(o.id,false)}>{o.status==='pending'?'Отклонить':'Снять'}</button></div>}</article>)}{!offices.length&&<p>Назначенных ролей пока нет.</p>}</div>
   {canInitiate&&<div className="officeAssignmentForm"><label>Добавить роль<input aria-label="Роль для назначения" list="gameOfficeOptions" value={role} maxLength={180} onChange={e=>setRole(e.target.value)} placeholder="Выберите или напишите роль"/><datalist id="gameOfficeOptions">{ROLES.map(r=><option value={r} key={r}/>)}</datalist></label><button disabled={busy||role.trim().length<2||offices.some(o=>o.role_title.toLowerCase()===role.trim().toLowerCase())} onClick={()=>void appoint()}>{g.teacher?'Назначить роль':'Предложить назначение'}</button><small>Переключение ролей — учебная ротация. Она не означает одновременное совмещение государственных должностей.</small></div>}
  </>}
  {!g.teacher&&target?.kind==='teacher'&&<p>Преподаватель имеет полный административный доступ.</p>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
