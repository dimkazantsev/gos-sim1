'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {prepareTelegramBotAvatar} from './telegramBotAvatar';
export default function TelegramConnection({gameId,teacher=false}:{gameId:string;teacher?:boolean}){
 const [status,setStatus]=useState<{linked:boolean;notifications_enabled:boolean}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const username=process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME||'GosSimsGameBot';
 const [activated,setActivated]=useState('');
 const [linkToken,setLinkToken]=useState(''),[linkIssuedAt,setLinkIssuedAt]=useState(0),[copied,setCopied]=useState(false);
 const tgAppLink=linkToken?'tg://resolve?domain='+encodeURIComponent(username)+'&start='+encodeURIComponent(linkToken):'';
 const tgWebLink=linkToken?'https://t.me/'+encodeURIComponent(username)+'?start='+encodeURIComponent(linkToken):'';
 async function activate(){
   setBusy(true);setError('');
   const {data,error:authError}=await supabase.auth.getSession();
   if(authError||!data.session?.access_token){setError('Сначала войдите в игру.');setBusy(false);return}
   try{
     const headers={'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token};
     const avatarJpegBase64=await prepareTelegramBotAvatar();
     const payload=JSON.stringify({gameId,avatarJpegBase64});
     // GitHub Pages is static and has no /api routes. Use the shared Vercel API
     // used by the document uploader; same-origin requests stay relative on Vercel.
     const origin=(process.env.NEXT_PUBLIC_GAME_API_ORIGIN||
       (window.location.hostname.endsWith('.github.io')?'https://gos-sim1.vercel.app':'')).replace(/[/]$/,'');
     const endpoint=origin+'/api/telegram/activate';
     const response=await fetch(endpoint,{method:'POST',headers,body:payload,cache:'no-store',signal:AbortSignal.timeout(55000)});
     const contentType=response.headers.get('content-type')||'';
     if(!contentType.toLowerCase().includes('application/json')){
       if(response.status===405)throw new Error('HTTP 405: серверный API не принимает POST. Используйте обновлённую версию сайта и проверьте адрес API.');
       throw new Error('Сервер активации не вернул JSON (HTTP '+response.status+').');
     }
     const result=await response.json() as {ok?:boolean;error?:string;logo?:boolean;warnings?:string[];webhook?:boolean;commands?:boolean;menu?:boolean};
     if(!response.ok||!result.ok)throw new Error(result.error||'Не удалось активировать бота.');
     setActivated((result.warnings?.length?'Webhook, команды и меню подтверждены. Дополнительные настройки: '+result.warnings.join('; '):'Webhook, команды и меню подтверждены Telegram API.')+(result.logo?' Эмблема обновлена.':''));setError('');
   }catch(e){setError(e instanceof Error?e.name==='TimeoutError'?'Сервер не ответил за 20 секунд. Повторите попытку.':e.message:'Ошибка активации')}
   finally{setBusy(false)}
 }
 async function checkBot(){
  setBusy(true);setError('');setActivated('');
  try{
   const auth=await supabase.auth.getSession();
   if(!auth.data.session?.access_token)throw new Error('Войдите в игру.');
   const origin=(process.env.NEXT_PUBLIC_GAME_API_ORIGIN||
     (window.location.hostname.endsWith('.github.io')?'https://gos-sim1.vercel.app':'')).replace(/[/]$/,'');
   const response=await fetch(origin+'/api/telegram/activate?gameId='+encodeURIComponent(gameId),{
    headers:{Authorization:'Bearer '+auth.data.session.access_token},cache:'no-store',
    signal:AbortSignal.timeout(17000)
   });
   const x=await response.json() as {ok?:boolean;error?:string;webhook?:boolean;commands?:boolean;menu?:boolean};
   if(!response.ok||!x.ok)throw new Error(x.error||'Не удалось проверить Telegram.');
   setActivated('Webhook: '+(x.webhook?'подтверждён':'не подтверждён')+
    '. Команды: '+(x.commands?'подтверждены':'не подтверждены')+
    '. Меню: '+(x.menu?'подтверждено':'не подтверждено')+'.');
   if(!x.webhook||!x.commands||!x.menu)setError('Настройка неполная. Выполните повторную активацию.');
  }catch(e){setError(e instanceof Error?e.message:'Ошибка проверки Telegram.')}
  finally{setBusy(false)}
 }
 async function refresh(){
   try{const r=await supabase.rpc('telegram_status',{p_game_id:gameId});if(r.error)throw r.error;setStatus(r.data as typeof status);if(r.data?.linked){setLinkToken('');setLinkIssuedAt(0)}}
   catch(e){setError(e instanceof Error?e.message:'Не удалось получить состояние Telegram')}
 }
 useEffect(()=>{
  void refresh();
  const focus=()=>void refresh();
  const visible=()=>{if(document.visibilityState==='visible')void refresh()};
  window.addEventListener('focus',focus);
  document.addEventListener('visibilitychange',visible);
  return()=>{window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visible)};
 },[gameId]);
 async function link(){
  setBusy(true);setError('');setCopied(false);
  // Open no browser window after await: async window.open was blocked by popup blockers.
  // Instead render a user-clickable tg:// link and a fallback /start command.
  try{
   const r=await supabase.rpc('telegram_generate_link',{p_game_id:gameId});
   if(r.error)throw r.error;
   if(!/^[A-Za-z0-9_]{5,32}$/.test(username))throw new Error('Имя Telegram-бота настроено неверно.');
   if(typeof r.data!=='string'||!/^[a-f0-9]{48}$/.test(r.data))throw new Error('Не удалось получить корректный код привязки.');
   setLinkToken(r.data);setLinkIssuedAt(Date.now());
  }catch(e){setLinkToken('');setError(e instanceof Error?e.message:'Не удалось создать ссылку привязки.')}
  finally{setBusy(false)}
 }
 async function change(kind:'unlink'|'toggle'){
  setBusy(true);setError('');
  const r=kind==='unlink'?await supabase.rpc('telegram_unlink',{p_game_id:gameId}):await supabase.rpc('telegram_configure',{p_game_id:gameId,p_enabled:!status?.notifications_enabled});
  if(r.error)setError(r.error.message);else await refresh();setBusy(false);
 }
 return <section className="surface" style={{padding:20,marginTop:20}}>
  <h2 style={{fontSize:19,margin:'0 0 8px'}}>Telegram — ГОС.ID</h2>
  {status&&!status.linked&&<p className="telegramLinkWarning" role="status"><strong>Telegram не привязан к этому аккаунту.</strong> Уведомления о документах, упоминаниях, голосованиях и событиях не могут поступать, пока вы не завершите привязку через бота. После команды «Начать» вернитесь сюда: состояние обновится автоматически.</p>}
  {status?.linked&&!status.notifications_enabled&&<p role="status" className="telegramLinkWarning">Аккаунт привязан, но уведомления отключены. Включите их кнопкой ниже.</p>}
  <p style={{margin:'0 0 14px',opacity:.8}}>{status?.linked?'Telegram привязан к вашему игровому аккаунту.':'Откройте бота, нажмите «Начать» и пользуйтесь удобным меню. Уведомления о вашей игре доступны после привязки.'}</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   {!status?.linked?<button type="button" disabled={busy} onClick={()=>void link()}>{busy?'Подготавливаем ссылку…':linkToken?'Обновить код привязки':'Привязать Telegram'}</button>:<>
    <button type="button" disabled={busy} onClick={()=>void change('toggle')}>{status.notifications_enabled?'Отключить уведомления':'Включить уведомления'}</button>
    <button type="button" disabled={busy} onClick={()=>void change('unlink')}>Отвязать Telegram</button>
   </>}
   <button type="button" onClick={()=>void refresh()}>Обновить статус привязки</button>
   {teacher&&<><button type="button" disabled={busy} onClick={()=>void checkBot()}>Проверить Telegram</button><button type="button" disabled={busy} onClick={()=>void activate()}>Активировать бота</button></>}
  </div>
  {!status?.linked&&linkToken&&<div className="telegramLinkSteps" role="group" aria-label="Способы открытия Telegram">
   <p><strong>Код создан.</strong> Он действует 10 минут. Выберите способ открытия Telegram:</p>
   <div className="telegramLinkChoices">
    <a className="primary" href={tgAppLink}>Открыть в приложении Telegram</a>
    <a className="secondary" href={tgWebLink} target="_blank" rel="noopener noreferrer">Открыть страницу бота</a>
    <a className="secondary" href="https://web.telegram.org/k/" target="_blank" rel="noopener noreferrer">Telegram Web</a>
   </div>
   <p>Если переход из браузера не срабатывает, найдите <strong>@{username}</strong> в Telegram и отправьте ему команду привязки:</p>
   <div className="telegramLinkManual">
    <code>{'/start '+linkToken}</code>
    <button type="button" className="secondary" onClick={()=>{
     if(!navigator.clipboard?.writeText){setCopied(false);return;}
     void navigator.clipboard.writeText('/start '+linkToken).then(()=>setCopied(true)).catch(()=>setCopied(false));
    }}>{copied?'Скопировано':'Скопировать команду'}</button>
   </div>
   <p className="telegramLinkDisclaimer">Если Telegram сначала показывает кнопку «Начать» (START), нажмите её, а затем при необходимости отправьте скопированную команду /start с кодом. После этого вернитесь сюда и обновите статус.</p>
   {Date.now()-linkIssuedAt>=600000&&<p role="alert">Срок действия кода мог закончиться. Нажмите «Обновить код привязки».</p>}
  </div>}
  {activated&&<p role="status">{activated}</p>}
  {error&&<p role="alert" style={{color:'var(--danger,#b73535)'}}>{error}</p>}
 </section>;
}
