'use client';
import {useEffect,useState} from 'react';
import {CheckCircle2,KeyRound,LockKeyhole,Mail,RefreshCw,ShieldCheck} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
type LoginEmail={user_id:string;email:string;verified_at:string};
export default function ProfileSecurityPanel({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,members}=g;
 const [registered,setRegistered]=useState<LoginEmail[]>([]);
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [confirm,setConfirm]=useState('');
 const [verified,setVerified]=useState(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const mine=registered.find(x=>x.user_id===me?.user_id);
 async function load(){
  if(!game)return;
  const [r,u]=await Promise.all([
   supabase.from('member_login_emails').select('user_id,email,verified_at').eq('game_id',game.id),
   supabase.auth.getUser()
  ]);
  if(!r.error)setRegistered((r.data||[]) as LoginEmail[]);
  const actor=u.data.user;
  if(actor?.email){setEmail(actor.email);setVerified(!actor.is_anonymous&&!!actor.email_confirmed_at)}
  else setVerified(false);
 }
 useEffect(()=>{void load()},[game?.id,me?.user_id]);
 async function link(){
  if(!email.trim()||busy)return;
  setBusy(true);setNotice('');
  const r=await supabase.auth.updateUser({email:email.trim().toLowerCase()});
  setNotice(r.error?'Не удалось привязать почту: '+r.error.message:'Проверьте почту и перейдите по ссылке подтверждения. Затем вернитесь сюда.');
  setBusy(false);
 }
 async function check(){
  if(!game||busy)return;
  setBusy(true);setNotice('');
  const u=await supabase.auth.getUser();const actor=u.data.user;
  if(!actor?.email||actor.is_anonymous||!actor.email_confirmed_at){
   setNotice('Почта пока не подтверждена. Проверьте входящие и папку «Спам».');
  }else{
   setVerified(true);setEmail(actor.email);
   const r=await supabase.from('member_login_emails').upsert({game_id:game.id,user_id:actor.id,email:actor.email.toLowerCase(),verified_at:new Date().toISOString()},{onConflict:'game_id,user_id'});
   setNotice(r.error?'Почта подтверждена, но запись профиля не обновлена: '+r.error.message:'Почта подтверждена. Установите личный пароль.');
   await load();
  }
  setBusy(false);
 }
 async function savePassword(){
  if(!verified||password.length<10||password!==confirm||busy){setNotice('Пароль должен содержать не менее 10 символов и совпадать с подтверждением.');return}
  setBusy(true);setNotice('');
  const r=await supabase.auth.updateUser({password});
  if(r.error)setNotice('Не удалось установить пароль: '+r.error.message);
  else{setPassword('');setConfirm('');setNotice('Личный пароль сохранён в Supabase Auth. Используйте почту и пароль при следующем входе.');await check()}
  setBusy(false);
 }
 async function reset(targetEmail:string){
  if(busy)return;
  setBusy(true);setNotice('');
  const r=await supabase.auth.resetPasswordForEmail(targetEmail,{redirectTo:window.location.origin+'/auth/update-password'});
  setNotice(r.error?'Не удалось отправить ссылку: '+r.error.message:'Запрос на восстановление отправлен. Если адрес зарегистрирован, студент получит письмо со ссылкой.');
  setBusy(false);
 }
 if(!game||!me)return null;
 return <section className="profileSecurity" aria-label="Личный вход и восстановление доступа">
  <header><div><small>БЕЗОПАСНОСТЬ УЧЁТНОЙ ЗАПИСИ</small><h2>Личный пароль</h2></div><KeyRound size={22}/></header>
  <p>Для входа с другого устройства привяжите почту и установите пароль. Преподаватель может отправить письмо для восстановления, но прочитать чужой пароль не может.</p>
  <div className="profileSecurityGrid">
   <label>Ваш адрес электронной почты<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Имя@пример.рф" disabled={verified||busy}/></label>
   <button type="button" disabled={busy||verified||!email.includes('@')} onClick={()=>void link()}><Mail size={17}/>{verified?'Почта подтверждена':'Привязать почту'}</button>
   <button type="button" disabled={busy||verified} onClick={()=>void check()}><RefreshCw size={17}/> Проверить подтверждение</button>
  </div>
  {verified&&<div className="profilePasswordFields">
   <label>Новый личный пароль<input type="password" autoComplete="new-password" minLength={10} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Не менее 10 символов"/></label>
   <label>Повторите пароль<input type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Подтверждение пароля"/></label>
   <button type="button" className="primary" disabled={busy||password.length<10||password!==confirm} onClick={()=>void savePassword()}><ShieldCheck size={17}/> Сохранить пароль</button>
  </div>}
  {mine&&<p className="profileSecurityVerified"><CheckCircle2 size={17}/> Для входа привязана почта: {mine.email}</p>}
  {teacher&&<details className="profileSecurityRecovery"><summary><LockKeyhole size={17}/> Восстановление доступа участников</summary>
   <p>В целях безопасности пароли не отображаются. После нажатия студент получит письмо со ссылкой для установки нового пароля. Общий код игры остаётся без изменений.</p>
   <div>{members.filter(m=>m.kind==='student').map(m=>{const item=registered.find(x=>x.user_id===m.user_id);
    return <article key={m.user_id}><div><b>{m.full_name}</b><small>{item?.email||'Почта ещё не привязана'}</small></div>
      <button type="button" disabled={busy||!item} onClick={()=>item&&void reset(item.email)}>Отправить восстановление</button></article>
   })}</div>
  </details>}
  {notice&&<p className="profileSecurityNotice" role="status">{notice}</p>}
 </section>;
}
