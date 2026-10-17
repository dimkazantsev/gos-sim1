'use client';
import {userError} from '@/lib/userError';
import {useEffect,useState} from 'react';
import {Archive,Download,ShieldAlert,Trash2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {downloadFullGameArchive,enumerateGameAssets,purgeGameAssets,saveGameBlob} from './gameArchive';
import TeacherAccessCodes from './TeacherAccessCodes';
import {preparePortableSession,type SessionArchive} from './portableSession';
import {canPermanentlyDeleteGame,freshGameBackupReceipt,gameBackupReceiptKey} from './sessionDeletionGuard';
type Session={id:string;title:string;game_code:string;owner_id:string;status:string;created_at:string};
export default function SessionManager({g}:{g:ReturnTypeRepublic}){
 const {me,teacher,game}=g;
 const [sessions,setSessions]=useState<Session[]>([]);
 const [admin,setAdmin]=useState(false);
 const [selected,setSelected]=useState('');
 const [typed,setTyped]=useState('');
 const [backedUp,setBackedUp]=useState<Record<string,string>>({});
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [progress,setProgress]=useState('');
 const candidate=sessions.find(s=>s.id===selected);
 const receiptKey=candidate&&me?gameBackupReceiptKey(me.user_id,candidate.id):'';
 let storedReceipt:string|null=null;
 try{if(receiptKey&&typeof window!=='undefined')storedReceipt=window.sessionStorage.getItem(receiptKey)}catch{}
 const backupReady=freshGameBackupReceipt(backedUp[receiptKey]||storedReceipt);
 const deleteAllowed=!!candidate&&canPermanentlyDeleteGame({busy,confirmed,typed,code:candidate.game_code,backupReady});
 async function refresh(){
  if(!teacher||!me)return;
  const [a,b]=await Promise.all([
   supabase.from('games').select('id,title,game_code,owner_id,status,created_at').order('created_at',{ascending:false}),
   supabase.rpc('is_my_platform_admin')
  ]);
  if(!b.error)setAdmin(!!b.data);
  if(!a.error)setSessions((a.data||[]) as Session[]);
 }
 useEffect(()=>{void refresh()},[me?.user_id,game?.id,teacher]);
 async function exportOne(s:Session,format:'json'|'zip'|'html'){
  if(busy)return;setBusy(true);setNotice('');setProgress('Подготавливаем архив…');
  try{
   const suffix=s.game_code.replace(/[^a-zA-Zа-яА-Я0-9-]/g,'_');
   if(format==='zip'){
    const blob=await downloadFullGameArchive(s.id,(done,total)=>setProgress('Файлов включено: '+done+' из '+total));
    saveGameBlob(blob,'GOS-ID-'+suffix+'-full.zip');
   }else{
    const r=await supabase.rpc('export_game_data',{p_game:s.id});
    if(r.error)throw r.error;
    if(format==='html'){
     const portable=await preparePortableSession(r.data as SessionArchive);
     saveGameBlob(new Blob([portable.html],{type:'text/html'}),'GOS-ID-'+suffix+'.html');
    }else saveGameBlob(new Blob([JSON.stringify(r.data,null,2)],{type:'application/json'}),'GOS-ID-'+suffix+'.json');
   }
   if(format==='zip'&&me){
    const key=gameBackupReceiptKey(me.user_id,s.id),timestamp=String(Date.now());
    setBackedUp(old=>({...old,[key]:timestamp}));
    try{window.sessionStorage.setItem(key,timestamp)}catch{/* In-memory receipt remains usable until the page is closed. */}
   }
   setNotice('Архив сформирован и передан браузеру. Проверьте, что файл действительно сохранился перед удалением.');
  }catch(e){setNotice('Ошибка экспорта: '+((userError(e)||'Неизвестная ошибка')))}
  finally{setBusy(false);setProgress('')}
 }
 async function deleteOne(){
  const s=candidate;if(!s||!teacher||!deleteAllowed)return;
  if(s.owner_id!==me?.user_id&&!admin){setNotice('Удалять сеансы может только их владелец или подтверждённый глобальный администратор.');return}
  if(!backupReady){setNotice('Сначала сформируйте свежий полный ZIP-архив этого сеанса и проверьте, что файл сохранён.');return}
  if(!window.confirm('Вы действительно хотите безвозвратно удалить игру «'+s.title+'»? Будут удалены все записи, участники, события, оценки, сообщения, НПА и файлы.'))return;
  setBusy(true);setNotice('');
  try{
   const first=await supabase.rpc('prepare_game_deletion',{p_game:s.id,p_code:typed});
   if(first.error)throw first.error;
   setProgress('Удаление загруженных файлов…');
   await purgeGameAssets(s.id,(done,total)=>setProgress('Удалено файлов: '+done+' из '+total));
   // Race protection: the server refuses to drop a game while even one object remains.
   const [assets,media]=await Promise.all([
    enumerateGameAssets(s.id,'game-assets'),enumerateGameAssets(s.id,'game-media')
   ]);
   if(assets.length||media.length)throw Error('Остались файлы: '+(assets.length+media.length)+'. Удаление базы отменено.');
   setProgress('Удаление игровых записей и связей…');
   const last=await supabase.rpc('delete_game_permanently',{p_game:s.id,p_code:typed});
   if(last.error)throw last.error;
   setNotice('Сеанс «'+s.title+'» и все его файлы удалены. Принадлежащие человеку учётные записи других игр не затронуты.');
   if(receiptKey){try{window.sessionStorage.removeItem(receiptKey)}catch{};setBackedUp(old=>{const next={...old};delete next[receiptKey];return next})}
   setSelected('');setTyped('');setConfirmed(false);await refresh();
   if(s.id===game?.id)window.location.assign('/');
  }catch(e){setNotice('Операция остановлена: '+((userError(e)||'Неизвестная ошибка'))+'. Сеанс сохраняется в архивном состоянии, пока очистка не завершена.')}
  finally{setBusy(false);setProgress('')}
 }
 if(!teacher||!me)return null;
 return <section className="profileSessionManager" aria-label="Экспорт и удаление сеансов">
  <header><div><small>АРХИВ И БЕЗОПАСНОСТЬ</small><h2>Мои игровые сеансы</h2><p>JSON сохраняет данные; HTML открывается в одном браузере; ZIP включает файлы и сервер для локальной сети. Перед удалением сохраните полный ZIP.</p></div><Archive size={22}/></header>
  {game&&<TeacherAccessCodes gameId={game.id}/>}
  <div className="profileSessionRows">{sessions.filter(s=>s.owner_id===me.user_id||admin).map(s=><article key={s.id} className={selected===s.id?'selected':''}>
   <div><b>{s.title}</b><span>Код: {s.game_code} · {s.status==='archived'?'В архиве':s.status==='running'?'Игра запущена':'Подготовка'}</span></div>
   <div className="profileSessionActions">
    <button type="button" disabled={busy} onClick={()=>void exportOne(s,'json')}><Download size={17}/> JSON</button>
    <button type="button" disabled={busy} onClick={()=>void exportOne(s,'html')}><Download size={17}/> HTML</button>
    <button type="button" disabled={busy} onClick={()=>void exportOne(s,'zip')}><Archive size={17}/> ZIP · Локальная Игра</button>
    <button type="button" className="danger" disabled={busy} onClick={()=>{setSelected(selected===s.id?'':s.id);setTyped('');setConfirmed(false);setNotice('')}}><Trash2 size={17}/> Удалить</button>
   </div>
  </article>)}</div>
  {candidate&&<div className="profileSessionDelete">
   <h3><ShieldAlert size={20}/> Безвозвратное удаление: {candidate.title}</h3>
   <p>После удаления восстановление возможно только из резервной копии. Останутся лишь самостоятельные аккаунты пользователей и сведения, относящиеся к другим играм. Отдельные файлы должны быть удалены до удаления базы.</p>
   <label>Введите точный код сеанса: {candidate.game_code}<input autoComplete="off" value={typed} onChange={e=>setTyped(e.target.value.toUpperCase())} placeholder="Код сеанса"/></label>
   <label className="profileSessionConfirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Я сохранил(а) резервную копию и понимаю, что действие необратимо.</label>
   <p role="status" className="profileSessionNotice">{backupReady?'Полный ZIP подготовлен в этом сеансе браузера. Убедитесь, что файл действительно сохранился. После проверки кода и подтверждения можно удалить игру.':'Для разблокировки удаления сначала нажмите «ZIP · Локальная Игра» у этого сеанса и дождитесь завершения экспорта. Затем проверьте, что ZIP сохранился. Отметка экспорта сохраняется при обновлении страницы в этой вкладке в течение одного часа.'}</p>
   <button type="button" className="danger" disabled={!deleteAllowed} onClick={()=>void deleteOne()}><Trash2 size={17}/> Полностью удалить сеанс</button>
   <button type="button" onClick={()=>{setSelected('');setTyped('');setConfirmed(false)}}>Отмена</button>
  </div>}
  {progress&&<p role="status" className="profileSessionProgress">{progress}</p>}
  {notice&&<p role="status" className="profileSessionNotice">{notice}</p>}
 </section>;
}
