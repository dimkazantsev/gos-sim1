'use client';
import {useEffect,useState} from 'react';
import {Archive,Download,ShieldAlert,Trash2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {downloadFullGameArchive,enumerateGameAssets,purgeGameAssets,saveGameBlob} from './gameArchive';
type Session={id:string;title:string;game_code:string;owner_id:string;status:string;created_at:string};
export default function SessionManager({g}:{g:ReturnTypeRepublic}){
 const {me,teacher,game}=g;
 const [sessions,setSessions]=useState<Session[]>([]);
 const [admin,setAdmin]=useState(false);
 const [selected,setSelected]=useState('');
 const [typed,setTyped]=useState('');
 const [backedUp,setBackedUp]=useState<string[]>([]);
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [progress,setProgress]=useState('');
 const [guestCode,setGuestCode]=useState('');
 const [guestCreated,setGuestCreated]=useState('');
 const candidate=sessions.find(s=>s.id===selected);
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
 async function exportOne(s:Session,full:boolean){
  if(busy)return;setBusy(true);setNotice('');setProgress('Подготавливаем архив…');
  try{
   const suffix=s.game_code.replace(/[^a-zA-Zа-яА-Я0-9-]/g,'_');
   if(full){
    const blob=await downloadFullGameArchive(s.id,(done,total)=>setProgress('Файлов включено: '+done+' из '+total));
    saveGameBlob(blob,'GOS-SIMS-'+suffix+'-full.zip');
   }else{
    const r=await supabase.rpc('export_game_data',{p_game:s.id});
    if(r.error)throw r.error;
    saveGameBlob(new Blob([JSON.stringify(r.data,null,2)],{type:'application/json'}),'GOS-SIMS-'+suffix+'.json');
   }
   setBackedUp(old=>old.includes(s.id)?old:[...old,s.id]);
   setNotice('Архив сформирован и передан браузеру. Проверьте, что файл действительно сохранился перед удалением.');
  }catch(e){setNotice('Ошибка экспорта: '+(e instanceof Error?e.message:'Неизвестная ошибка'))}
  finally{setBusy(false);setProgress('')}
 }
 async function inviteGuest(){
  if(!game||busy||guestCode.trim().length<6)return;
  setBusy(true);setNotice('');
  const r=await supabase.rpc('create_observer_invite',{p_game_id:game.id,p_code:guestCode.trim()});
  if(r.error)setNotice('Не удалось создать гостевой код: '+r.error.message);
  else{setGuestCreated(guestCode.trim());setGuestCode('');setNotice('Гостевой код создан. Сохраните его сейчас — позже он не отображается.')}
  setBusy(false);
 }
 async function deleteOne(){
  const s=candidate;if(!s||!teacher||busy||!confirmed||typed!==s.game_code)return;
  if(s.owner_id!==me?.user_id&&!admin){setNotice('Удалять сеансы может только их владелец или подтверждённый глобальный администратор.');return}
  if(!backedUp.includes(s.id)){setNotice('Сначала сформируйте и сохраните резервную копию этого сеанса.');return}
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
   setNotice('Сеанс «'+s.title+'» и все его файлы удалены. Принадлежащие человеку аккаунты Auth других игр не затронуты.');
   setSelected('');setTyped('');setConfirmed(false);await refresh();
   if(s.id===game?.id)window.location.assign('/');
  }catch(e){setNotice('Операция остановлена: '+(e instanceof Error?e.message:'Неизвестная ошибка')+'. Сеанс сохраняется в архивном состоянии, пока очистка не завершена.')}
  finally{setBusy(false);setProgress('')}
 }
 if(!teacher||!me)return null;
 return <section className="profileSessionManager" aria-label="Экспорт и удаление сеансов">
  <header><div><small>АРХИВ И БЕЗОПАСНОСТЬ</small><h2>Мои игровые сеансы</h2><p>Скачайте данные или полный архив с файлами. Удаление выполняется только по подтверждённому коду сеанса.</p></div><Archive size={22}/></header>
  <div className="profileGuestInvites"><h3>Гостевой просмотр текущей игры</h3><p>Гость сможет читать открытые разделы и журнал, но не сможет голосовать, загружать документы, менять показатели или отправлять сообщения.</p>
   <div><input type="text" autoComplete="off" minLength={6} value={guestCode} onChange={e=>setGuestCode(e.target.value)} placeholder="Новый код гостя · не менее 6 символов"/>
     <button type="button" disabled={busy||guestCode.trim().length<6} onClick={()=>void inviteGuest()}>Создать гостевой код</button></div>
   {guestCreated&&<p role="status">Созданный код: <code>{guestCreated}</code> · Передайте гостю для входа с главной страницы.</p>}
  </div>
  <div className="profileSessionRows">{sessions.filter(s=>s.owner_id===me.user_id||admin).map(s=><article key={s.id} className={selected===s.id?'selected':''}>
   <div><b>{s.title}</b><span>Код: {s.game_code} · {s.status==='archived'?'В архиве':s.status==='running'?'Игра запущена':'Подготовка'}</span></div>
   <div className="profileSessionActions">
    <button type="button" disabled={busy} onClick={()=>void exportOne(s,false)}><Download size={17}/> JSON</button>
    <button type="button" disabled={busy} onClick={()=>void exportOne(s,true)}><Archive size={17}/> ZIP + Файлы</button>
    <button type="button" className="danger" disabled={busy} onClick={()=>{setSelected(selected===s.id?'':s.id);setTyped('');setConfirmed(false);setNotice('')}}><Trash2 size={17}/> Удалить</button>
   </div>
  </article>)}</div>
  {candidate&&<div className="profileSessionDelete">
   <h3><ShieldAlert size={20}/> Безвозвратное удаление: {candidate.title}</h3>
   <p>После удаления восстановление возможно только из резервной копии. Останутся лишь самостоятельные аккаунты пользователей и сведения, относящиеся к другим играм. Отдельные файлы должны быть удалены до удаления базы.</p>
   <label>Введите точный код сеанса: {candidate.game_code}<input autoComplete="off" value={typed} onChange={e=>setTyped(e.target.value.toUpperCase())} placeholder="Код сеанса"/></label>
   <label className="profileSessionConfirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Я сохранил(а) резервную копию и понимаю, что действие необратимо.</label>
   <button type="button" className="danger" disabled={busy||!confirmed||typed!==candidate.game_code||!backedUp.includes(candidate.id)} onClick={()=>void deleteOne()}><Trash2 size={17}/> Полностью удалить сеанс</button>
   <button type="button" onClick={()=>{setSelected('');setTyped('');setConfirmed(false)}}>Отмена</button>
  </div>}
  {progress&&<p role="status" className="profileSessionProgress">{progress}</p>}
  {notice&&<p role="status" className="profileSessionNotice">{notice}</p>}
 </section>;
}
