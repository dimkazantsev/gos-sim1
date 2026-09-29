'use client';
import {FormEvent,useEffect,useState} from 'react';
import Link from 'next/link';
import {CheckCircle2,KeyRound} from 'lucide-react';
import {supabase} from '@/lib/supabase';
export default function UpdatePassword(){
 const [ready,setReady]=useState(false),[newPassword,setNewPassword]=useState(''),[repeat,setRepeat]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[done,setDone]=useState(false);
 useEffect(()=>{
  void supabase.auth.getSession().then(r=>setReady(!!r.data.session));
  const {data}=supabase.auth.onAuthStateChange((event,session)=>{
   if(event==='PASSWORD_RECOVERY'||event==='SIGNED_IN')setReady(!!session);
  });
  return()=>data.subscription.unsubscribe();
 },[]);
 async function save(e:FormEvent){
  e.preventDefault();setMessage('');
  if(newPassword.length<10||newPassword!==repeat){setMessage('Минимум 10 символов. Повторите новый пароль без ошибок.');return}
  setBusy(true);
  const r=await supabase.auth.updateUser({password:newPassword});
  if(r.error)setMessage(r.error.message);
  else{setDone(true);setNewPassword('');setRepeat('');setMessage('Личный пароль изменён. Теперь можно войти в игру с подтверждённой почтой.')}
  setBusy(false);
 }
 return <main className="passwordRecoveryPage"><div className="passwordRecoveryCard">
  <span className="wordmark">GOS//SIMS</span><KeyRound size={32} aria-hidden="true"/>
  <h1>Восстановление доступа</h1>
  {!ready?<p>Перейдите по ссылке из письма для восстановления. Если ссылка устарела, запросите новую на странице входа.</p>:
   <form onSubmit={save}><label>Новый пароль<input autoComplete="new-password" type="password" minLength={10} required value={newPassword} onChange={e=>setNewPassword(e.target.value)} disabled={busy||done}/></label>
    <label>Повторите пароль<input autoComplete="new-password" type="password" minLength={10} required value={repeat} onChange={e=>setRepeat(e.target.value)} disabled={busy||done}/></label>
    <button className="primary" type="submit" disabled={busy||done||newPassword.length<10||newPassword!==repeat}>Сохранить новый пароль</button></form>}
  {message&&<p role="status" className={done?'passwordRecoverySuccess':''}>{done&&<CheckCircle2 size={18}/>} {message}</p>}
  <Link href="/">Вернуться на страницу входа</Link>
 </div></main>;
}
