'use client';
import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,KeyRound,LockKeyhole,Mail,RefreshCw,ShieldCheck} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';
import type {ProfileSetupField} from './profileSetup';
import {describeProfileEmailError,EMAIL_RESEND_GUARD_MS} from './profileEmailDelivery';
type LoginEmail={user_id:string;email:string;verified_at:string};
export default function ProfileSecurityPanel({g,missing=[],onChanged}:{g:ReturnTypeRepublic;missing?:ProfileSetupField[];onChanged?:()=>void}){
 const {game,me,teacher,members}=g;
 const [registered,setRegistered]=useState<LoginEmail[]>([]);
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [confirm,setConfirm]=useState('');
 const [verified,setVerified]=useState(false);
 const [mailRequested,setMailRequested]=useState(false);
 const [pendingEmail,setPendingEmail]=useState('');
 const [existingEmail,setExistingEmail]=useState('');
 const mailInFlight=useRef(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [emailRetryUntil,setEmailRetryUntil]=useState(0);
 const [now,setNow]=useState(0);
 const retryMinutes=Math.max(0,Math.ceil((emailRetryUntil-now)/60000));
 useEffect(()=>{
  if(!game?.id)return;
  try{const value=Number(window.localStorage.getItem('gos-id:auth-email-retry:'+game.id)||0);setEmailRetryUntil(Number.isFinite(value)&&value>Date.now()?value:0)}catch{setEmailRetryUntil(0)}
  setNow(Date.now());
 },[game?.id]);
 useEffect(()=>{
  if(!emailRetryUntil||emailRetryUntil<=Date.now())return;
  const interval=window.setInterval(()=>setNow(Date.now()),30_000);
  return()=>window.clearInterval(interval);
 },[emailRetryUntil]);
 function deferEmailRequest(durationMs:number){
  if(!game?.id)return;
  const until=Date.now()+durationMs;
  setEmailRetryUntil(until);setNow(Date.now());
  try{window.localStorage.setItem('gos-id:auth-email-retry:'+game.id,String(until))}catch{}
 }
 const mine=registered.find(x=>x.user_id===me?.user_id);
 async function load(){
  if(!game)return;
  const [r,u]=await Promise.all([
   supabase.from('member_login_emails').select('user_id,email,verified_at').eq('game_id',game.id),
   supabase.auth.getUser()
  ]);
  if(!r.error)setRegistered((r.data||[]) as LoginEmail[]);
  const actor=u.data.user;
  setPendingEmail(actor?.new_email?.toLowerCase()||'');
  if(!actor?.email&&actor?.new_email)setEmail(actor.new_email);
  if(actor?.email){
   setEmail(actor.email);
   const confirmed=!actor.is_anonymous&&!!actor.email_confirmed_at;
   setVerified(confirmed);
   // A verification redirect must complete the game-profile binding without
   // requiring a second manual click after the user returns to ГОС.ID.
   const stored=(r.data||[]).find(entry=>entry.user_id===actor.id);
   if(confirmed&&actor.id===me?.user_id&&(!stored||stored.email.toLowerCase()!==actor.email.toLowerCase())){
    const saved=await supabase.from('member_login_emails').upsert({
     game_id:game.id,user_id:actor.id,email:actor.email.toLowerCase(),
     verified_at:actor.email_confirmed_at
    },{onConflict:'game_id,user_id'});
    if(saved.error)setNotice('Почта подтверждена, но профиль не обновился: '+userError(saved.error));
    else onChanged?.();
   }
  }else setVerified(false);
 }
 useEffect(()=>{void load()},[game?.id,me?.user_id]);
 async function link(){
  if(!game||busy||mailInFlight.current||Date.now()<emailRetryUntil)return;
  const requestedEmail=email.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(requestedEmail)){
   setNotice('Укажите полный адрес электронной почты, например name@mail.ru.');return;
  }
  mailInFlight.current=true;
  setBusy(true);setNotice('');
  // GitHub Pages is a static shell: it cannot serve /game/[id] dynamically.
  // Complete the verification on the application server and deep-link to the profile.
  const origin=(process.env.NEXT_PUBLIC_GAME_API_ORIGIN||
   (window.location.hostname.endsWith('.github.io')?'https://gos-sim1.vercel.app':window.location.origin)).replace(/[/]$/,'');
  const redirect=new URL('/game/'+encodeURIComponent(game!.id),origin);
  redirect.searchParams.set('section','profile');
  try{
   const r=pendingEmail===requestedEmail
    ?await supabase.auth.resend({type:'email_change',email:requestedEmail,options:{emailRedirectTo:redirect.toString()}})
    :await supabase.auth.updateUser({email:requestedEmail},{emailRedirectTo:redirect.toString()});
   if(r.error){
    setMailRequested(false);
    const issue=describeProfileEmailError(r.error);
    setExistingEmail(issue.kind==='email_exists'?requestedEmail:'');
    if(issue.cooldownMs)deferEmailRequest(issue.cooldownMs);
    setNotice(issue.notice);
   }else{
    setExistingEmail('');setPendingEmail(requestedEmail);setMailRequested(true);deferEmailRequest(EMAIL_RESEND_GUARD_MS);
    setNotice('Письмо отправлено на '+requestedEmail+'. Откройте ссылку в письме, затем вернитесь сюда и нажмите «Проверить подтверждение» — независимо от того, какая страница открылась по ссылке.');
   }
  }catch(error){
   setMailRequested(false);setNotice('Не удалось отправить письмо: '+userError(error));
  }finally{
   mailInFlight.current=false;setBusy(false);
  }
 }
 async function check(){
  if(!game||busy)return;
  setBusy(true);setNotice('');
  const u=await supabase.auth.getUser();const actor=u.data.user;
  if(!actor?.email||actor.is_anonymous||!actor.email_confirmed_at){
   setNotice('Подтверждение пока не получено. Если письмо уже открывали, попробуйте нажать «Проверить подтверждение» ещё раз. Если ссылку не открывали — проверьте письмо и папку «Спам». Если ссылка недействительна, отправьте письмо повторно.');
  }else{
   setVerified(true);setEmail(actor.email);
   const r=await supabase.from('member_login_emails').upsert({game_id:game.id,user_id:actor.id,email:actor.email.toLowerCase(),verified_at:new Date().toISOString()},{onConflict:'game_id,user_id'});
   setNotice(r.error?'Почта подтверждена, но запись профиля не обновлена: '+userError(r.error):'Почта подтверждена. Теперь установите личный пароль и нажмите «Сохранить пароль».');
   if(!r.error)setMailRequested(false);
   await load();onChanged?.();
  }
  setBusy(false);
 }
 async function savePassword(){
  if(!verified||password.length<10||password!==confirm||busy){setNotice('Пароль должен содержать не менее 10 символов и совпадать с подтверждением.');return}
  setBusy(true);setNotice('');
  const r=await supabase.auth.updateUser({password});
  if(r.error)setNotice('Не удалось установить пароль: '+userError(r.error));
  else{setPassword('');setConfirm('');await load();onChanged?.();setNotice('Личный пароль сохранён. Используйте почту и пароль при следующем входе.')}
  setBusy(false);
 }
 async function reset(targetEmail:string,personal=false){
  if(busy||mailInFlight.current||(personal&&Date.now()<emailRetryUntil))return;
  mailInFlight.current=true;
  setBusy(true);setNotice('');
  // GitHub Pages cannot serve the Next.js recovery page: use the same
  // application origin as the email-verification flow.
  const origin=(process.env.NEXT_PUBLIC_GAME_API_ORIGIN||
   (window.location.hostname.endsWith('.github.io')?'https://gos-sim1.vercel.app':window.location.origin)).replace(/[/]$/,'');
  try{
   const r=await supabase.auth.resetPasswordForEmail(targetEmail,{redirectTo:origin+'/auth/update-password'});
   if(r.error){const issue=describeProfileEmailError(r.error);setNotice(issue.notice);if(issue.cooldownMs)deferEmailRequest(issue.cooldownMs)}
   else{setNotice('Запрос на восстановление отправлен. Если адрес зарегистрирован, на него придёт письмо со ссылкой для установки пароля. После этого войдите с почтой и личным паролем.');if(personal)deferEmailRequest(EMAIL_RESEND_GUARD_MS)}
  }catch(error){setNotice('Не удалось отправить ссылку: '+userError(error))}
  finally{mailInFlight.current=false;setBusy(false)}
 }
 if(!game||!me)return null;
 return <section className="profileSecurity" aria-label="Личный вход и восстановление доступа">
  <header><div><small>БЕЗОПАСНОСТЬ УЧЁТНОЙ ЗАПИСИ</small><h2>Личный пароль</h2></div><KeyRound size={22}/></header>
  <p>Для входа с другого устройства подтвердите почту и установите личный пароль. Преподаватель может отправить письмо для восстановления, но не может узнать ваш пароль.</p>
  <p>1. Нажмите «Отправить письмо для подтверждения». 2. Откройте письмо и перейдите по ссылке. 3. Вернитесь в этот раздел и нажмите «Проверить подтверждение» — независимо от того, что открылось по ссылке. 4. После подтверждения сохраните личный пароль.</p>
  <div className="profileSecurityGrid">
   <label data-profile-setup-field="email" className={missing.includes('email')?'profileSetupInvalid':''}>Ваш адрес электронной почты<input aria-invalid={missing.includes('email')} type="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setMailRequested(false);setExistingEmail('');setNotice('')}} placeholder="Имя@пример.рф" disabled={verified||busy}/></label>
   <button type="button" disabled={busy||verified||!email.includes('@')||retryMinutes>0} onClick={()=>void link()}><Mail size={17}/>{verified?'Почта подтверждена':retryMinutes>0?'Повтор через '+retryMinutes+' мин.':mailRequested?'Отправить письмо повторно':'Отправить письмо для подтверждения'}</button>
   <button type="button" disabled={busy} onClick={()=>void check()}><RefreshCw size={17}/> Проверить подтверждение</button>
  </div>
  {notice&&<p className="profileSecurityNotice" role="status">{notice}</p>}
  {retryMinutes>0&&!verified&&<p className="profileSecurityNotice" role="status">Письма временно не отправляются с этого устройства. Ожидание: примерно {retryMinutes} мин. Кнопка «Проверить подтверждение» работает независимо от этого ограничения.</p>}
  {existingEmail&&<div className="profileSecurityExisting">
   <p>Адрес уже связан с учётной записью. Восстановите доступ к ней или укажите другую почту для текущего профиля.</p>
   <button type="button" disabled={busy||retryMinutes>0} onClick={()=>void reset(existingEmail,true)}><Mail size={17}/>{retryMinutes>0?'Повтор через '+retryMinutes+' мин.':'Отправить письмо для восстановления доступа'}</button>
  </div>}
  {verified&&<div className={'profilePasswordFields'+(missing.includes('password')?' profileSetupInvalid':'')} data-profile-setup-field="password">
   <label>Новый личный пароль<input type="password" autoComplete="new-password" minLength={10} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Не менее 10 символов"/></label>
   <label>Повторите пароль<input type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Подтверждение пароля"/></label>
   <button type="button" className="primary" disabled={busy||password.length<10||password!==confirm} onClick={()=>void savePassword()}><ShieldCheck size={17}/> Сохранить пароль</button>
  </div>}
  {(missing.includes('email')||missing.includes('password'))&&<p className="profileSetupFieldError">{missing.includes('email')?'Подтвердите почту. ':''}{missing.includes('password')?'Установите личный пароль.':''}</p>}
  {mine&&verified&&<p className="profileSecurityVerified"><CheckCircle2 size={17}/> Для входа привязана почта: {mine.email}</p>}
  {teacher&&<details className="profileSecurityRecovery"><summary><LockKeyhole size={17}/> Восстановление доступа участников</summary>
   <p>В целях безопасности пароли не отображаются. После нажатия студент получит письмо со ссылкой для установки нового пароля. Общий код игры остаётся без изменений.</p>
   <div>{members.filter(m=>m.kind==='student').map(m=>{const item=registered.find(x=>x.user_id===m.user_id);
    return <article key={m.user_id}><div><b>{m.full_name}</b><small>{item?.email||'Почта ещё не привязана'}</small></div>
      <button type="button" disabled={busy||!item} onClick={()=>item&&void reset(item.email)}>Отправить восстановление</button></article>
   })}</div>
  </details>}
 </section>;
}
