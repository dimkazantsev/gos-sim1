'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
export default function TelegramConnection({gameId}:{gameId:string}){
 const [status,setStatus]=useState<{linked:boolean;notifications_enabled:boolean}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const username=process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME||'GosSimsGameBot';
 async function refresh(){const r=await supabase.rpc('telegram_status',{p_game_id:gameId});if(!r.error)setStatus(r.data as typeof status)}
 useEffect(()=>{void refresh()},[gameId]);
 async function link(){
  setBusy(true);setError('');
  const r=await supabase.rpc('telegram_generate_link',{p_game_id:gameId});
  if(r.error)setError(r.error.message);
  else if(!username)setError('Имя Telegram-бота пока не настроено на сервере.');
  else window.open('https://t.me/'+username+'?start='+r.data,'_blank','noopener,noreferrer');
  setBusy(false);
 }
 async function change(kind:'unlink'|'toggle'){
  setBusy(true);setError('');
  const r=kind==='unlink'?await supabase.rpc('telegram_unlink',{p_game_id:gameId}):await supabase.rpc('telegram_configure',{p_game_id:gameId,p_enabled:!status?.notifications_enabled});
  if(r.error)setError(r.error.message);else await refresh();setBusy(false);
 }
 return <section className="surface" style={{padding:20,marginTop:20}}>
  <h2 style={{fontSize:19,margin:'0 0 8px'}}>Telegram — GOS//SIMS</h2>
  <p style={{margin:'0 0 14px',opacity:.8}}>{status?.linked?'Telegram привязан к вашему игровому аккаунту.':'Получайте уведомления и отправляйте сообщения прямо из Telegram.'}</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   {!status?.linked?<button type="button" disabled={busy} onClick={()=>void link()}>Привязать Telegram</button>:<>
    <button type="button" disabled={busy} onClick={()=>void change('toggle')}>{status.notifications_enabled?'Отключить уведомления':'Включить уведомления'}</button>
    <button type="button" disabled={busy} onClick={()=>void change('unlink')}>Отвязать Telegram</button>
   </>}
   <button type="button" onClick={()=>void refresh()}>Обновить статус</button>
  </div>
  {error&&<p role="alert" style={{color:'var(--danger,#b73535)'}}>{error}</p>}
 </section>;
}
