'use client';
import {useRef,useState} from 'react';
import {Archive,ArrowRight,Download,ShieldAlert,Trash2} from 'lucide-react';
import {userError} from '@/lib/userError';
import {supabase} from '@/lib/supabase';
import {downloadFullGameArchive,downloadSessionArchive,enumerateGameAssets,purgeGameAssets,saveGameBlob} from './gameArchive';
import {preserveOwnTeacherAssets} from './preserveTeacherAssets';
import {preparePortableSession} from './portableSession';
import {canPermanentlyDeleteGame,freshGameBackupReceipt,gameBackupReceiptKey} from './sessionDeletionGuard';

export type ManagedGame={id:string;title:string;status:string;created_at:string;is_owner:boolean};
type Props={
 session:ManagedGame;
 isAdmin:boolean;
 disabled:boolean;
 currentGameId?:string;
 onOpen:()=>void;
 onDeleted:()=>Promise<void>;
 onBusyChange:(gameId:string|null)=>void;
};
/** One management row per game; no automatic archive downloads or duplicate game-list queries. */
export default function SessionManager({session,isAdmin,disabled,currentGameId,onOpen,onDeleted,onBusyChange}:Props){
 const [selected,setSelected]=useState(false);
 const [typed,setTyped]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [gameCode,setGameCode]=useState('');
 const [userId,setUserId]=useState('');
 const [backedUp,setBackedUp]=useState('');
 const [busy,setBusy]=useState(false);
 // React state commits asynchronously. Block a second click synchronously.
 const operationRef=useRef(false);
 const [notice,setNotice]=useState('');
 const [progress,setProgress]=useState('');
 const mayManage=session.is_owner||isAdmin;
 const receiptKey=userId?gameBackupReceiptKey(userId,session.id):'';
 let storedReceipt:string|null=null;
 try{if(receiptKey&&typeof window!=='undefined')storedReceipt=window.sessionStorage.getItem(receiptKey)}catch{}
 const backupReady=freshGameBackupReceipt(backedUp||storedReceipt);
 const deleteAllowed=selected&&mayManage&&canPermanentlyDeleteGame({busy:busy||disabled,confirmed,typed,code:gameCode,backupReady});

 async function getIdentity(){
  const auth=await supabase.auth.getSession();
  const id=auth.data.session?.user?.id;
  if(!id)throw Error('Войдите в подтверждённую учётную запись преподавателя.');
  return id;
 }
 async function readCode(){
  // Read only when a teacher explicitly exports or deletes, not for every row on mount.
  const result=await supabase.from('games').select('game_code,owner_id').eq('id',session.id).single();
  if(result.error)throw result.error;
  if(!result.data?.game_code)throw Error('Игра не найдена или нет доступа к её коду.');
  const id=await getIdentity();
  if(result.data.owner_id!==id&&!isAdmin)throw Error('Действие доступно только владельцу игры.');
  return {code:String(result.data.game_code),id};
 }
 function lock(){
  if(operationRef.current)return false;
  operationRef.current=true;
  setBusy(true);onBusyChange(session.id);
  return true;
 }
 function unlock(){operationRef.current=false;setBusy(false);onBusyChange(null)}
 async function exportOne(format:'json'|'zip'|'html'){
  if(disabled||busy||!mayManage||!lock())return;
  setNotice('');setProgress('Подготавливаем архив…');
  try{
   const {code,id}=await readCode();
   const suffix=code.replace(/[^a-zA-Zа-яА-Я0-9-]/g,'_');
   if(format==='zip'){
    const blob=await downloadFullGameArchive(session.id,(done,total,phase)=>setProgress((phase==='data'?'Таблиц выгружено: ':'Файлов включено: ')+done+' из '+total));
    saveGameBlob(blob,'GOS-ID-'+suffix+'-full.zip');
    const timestamp=String(Date.now()),key=gameBackupReceiptKey(id,session.id);
    setUserId(id);setBackedUp(timestamp);
    try{window.sessionStorage.setItem(key,timestamp)}catch{/* In-memory receipt remains available until unmount. */}
   }else{
    const archive=await downloadSessionArchive(session.id,(done,total)=>setProgress('Таблиц выгружено: '+done+' из '+total));
    if(format==='html'){
     const portable=await preparePortableSession(archive);
     saveGameBlob(new Blob([portable.html],{type:'text/html'}),'GOS-ID-'+suffix+'.html');
    }else saveGameBlob(new Blob([JSON.stringify(archive,null,2)],{type:'application/json'}),'GOS-ID-'+suffix+'.json');
   }
   setNotice('Файл передан браузеру. Проверьте, что он действительно сохранился.');
  }catch(e){setNotice('Ошибка экспорта: '+(userError(e)||'Неизвестная ошибка'))}
  finally{unlock();setProgress('')}
 }
 async function openDelete(){
  if(disabled||busy||!mayManage||operationRef.current)return;
  if(selected){setSelected(false);setTyped('');setConfirmed(false);setNotice('');return}
  if(!lock())return;
  setNotice('');
  try{
   const {code,id}=await readCode();
   setUserId(id);setGameCode(code);setSelected(true);setTyped('');setConfirmed(false);
  }catch(e){setNotice('Невозможно открыть удаление: '+(userError(e)||'Неизвестная ошибка'))}
  finally{unlock()}
 }
 async function deleteOne(){
  if(!deleteAllowed||!selected||!mayManage||operationRef.current)return;
  if(!backupReady){setNotice('Сначала подготовьте свежую полную ZIP-копию этой игры.');return}
  if(!lock())return;
  try{
   if(!window.confirm('Вы действительно хотите безвозвратно удалить игру «'+session.title+'»? Будут удалены участники, оценки, документы, события, сообщения и файлы игры. Личный профиль преподавателя, фотография и подпись сохраняются.'))return;
   setNotice('');
   const {code,id}=await readCode();
   if(code!==gameCode||typed!==code)throw Error('Код игры изменился. Повторите подтверждение удаления.');
   const first=await supabase.rpc('prepare_game_deletion',{p_game:session.id,p_code:code});
   if(first.error)throw first.error;
   setProgress('Сохраняем личные файлы преподавателя отдельно от игры…');
   await preserveOwnTeacherAssets(session.id,id);
   const assetGuard=await supabase.rpc('assert_game_teacher_assets_safe_to_purge',{p_game:session.id,p_code:code});
   if(assetGuard.error)throw assetGuard.error;
   setProgress('Удаление файлов игры…');
   await purgeGameAssets(session.id,(done,total)=>setProgress('Удалено файлов: '+done+' из '+total));
   const [assets,media]=await Promise.all([enumerateGameAssets(session.id,'game-assets'),enumerateGameAssets(session.id,'game-media')]);
   if(assets.length||media.length)throw Error('Остались файлы: '+(assets.length+media.length)+'. Удаление базы отменено.');
   setProgress('Удаление игровых записей и связей…');
   const last=await supabase.rpc('delete_game_permanently',{p_game:session.id,p_code:code});
   if(last.error)throw last.error;
   if(receiptKey){try{window.sessionStorage.removeItem(receiptKey)}catch{}}
   setBackedUp('');setSelected(false);setConfirmed(false);setTyped('');
   if(currentGameId===session.id){
    window.location.assign(window.location.hostname.endsWith('.github.io')?'/gos-sim1/':'/');
    return;
   }
   await onDeleted();
  }catch(e){setNotice('Удаление остановлено: '+(userError(e)||'Неизвестная ошибка')+'. Если подготовка удаления началась, игра остаётся в архивном состоянии.')}
  finally{unlock();setProgress('')}
 }
 return <div className="gosTeacherManagedGame">
  <article className="gosTeacherSessionRow">
   <div className="gosTeacherSessionIdentity">
    <b>{session.title}</b>
    <span>{session.status==='archived'?'В архиве':session.status==='running'?'Идёт игра':'Подготовка'} · {new Date(session.created_at).toLocaleDateString('ru-RU')}</span>
   </div>
   <div className="gosTeacherSessionControls">
    {mayManage&&<>
     <button type="button" className="secondary" disabled={disabled||busy} onClick={()=>void exportOne('json')}><Download size={17}/>JSON</button>
     <button type="button" className="secondary" disabled={disabled||busy} onClick={()=>void exportOne('html')}><Download size={17}/>HTML</button>
     <button type="button" className="secondary" disabled={disabled||busy} onClick={()=>void exportOne('zip')}><Archive size={17}/>ZIP · Локальная Игра</button>
     <button type="button" className="danger" aria-expanded={selected} disabled={disabled||busy} onClick={()=>void openDelete()}><Trash2 size={17}/>Удалить</button>
    </>}
    <button type="button" className="secondary gosTeacherOpenGame" disabled={disabled||busy} onClick={onOpen}>Открыть <ArrowRight size={16}/></button>
   </div>
  </article>
  {selected&&<div className="profileSessionDelete gosTeacherSessionDelete">
   <h3><ShieldAlert size={20}/>Безвозвратное удаление: {session.title}</h3>
   <p>Сначала сохраните полный ZIP, затем проверьте его на компьютере. Личные файлы и учётная запись преподавателя сохраняются отдельно.</p>
   <label>Введите точный код игры: {gameCode}<input autoComplete="off" value={typed} onChange={e=>setTyped(e.target.value.toUpperCase())} placeholder="Код игры"/></label>
   <label className="profileSessionConfirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Я сохранил(а) резервную копию и понимаю, что удаление необратимо.</label>
   <p role="status" className="profileSessionNotice">{backupReady?'Полный ZIP был сформирован в течение последнего часа. Проверьте, что файл сохранился.':'Для разблокировки удаления сначала нажмите «ZIP · Локальная Игра» в строке этой игры. Отметка экспорта сохраняется в текущей вкладке один час.'}</p>
   <div className="gosTeacherSessionDeleteActions">
    <button type="button" className="danger" disabled={!deleteAllowed} onClick={()=>void deleteOne()}><Trash2 size={17}/>Полностью удалить игру</button>
    <button type="button" disabled={busy} onClick={()=>{setSelected(false);setTyped('');setConfirmed(false)}}>Отмена</button>
   </div>
  </div>}
  {progress&&<p role="status" className="profileSessionProgress">{progress}</p>}
  {notice&&<p role="status" className="profileSessionNotice">{notice}</p>}
 </div>;
}
