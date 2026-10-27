'use client';
import {useEffect,useState} from 'react';
import {Check,CloudDownload,RefreshCw,WifiOff} from 'lucide-react';
import {clearRequestDiagnostics,getRequestDiagnostics} from '@/lib/supabase';
import {
 DEVICE_SNAPSHOT_EVENT,getLocalGameSnapshotInfo,
 type DeviceSnapshotEvent,type DeviceSnapshotInfo,type DeviceSnapshotStatus
} from '@/lib/localGameSnapshot';

type State='checking'|'empty'|DeviceSnapshotStatus;
export default function DeviceSyncStatus({gameId,userId,realtimeState}:{
 gameId:string;userId:string;realtimeState:'connecting'|'connected'|'disconnected'
}){
 const [phase,setPhase]=useState<State>('checking');
 const [info,setInfo]=useState<DeviceSnapshotInfo|null>(null);
 const [online,setOnline]=useState(true);
 const [diagnosticMessage,setDiagnosticMessage]=useState('');
 function downloadDiagnostics(){
  const entries=getRequestDiagnostics();
  if(!entries.length){setDiagnosticMessage('Записей пока нет.');return}
  try{
   const blob=new Blob([JSON.stringify({generated_at:new Date().toISOString(),scope:'current_browser_tab',note:'Код 0 означает ошибку сети или отмену. Время до ответа указано в миллисекундах.',entries},null,2)],{type:'application/json'});
   const href=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=href;link.download='gos-id-diagnostics.json';document.body.appendChild(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(href),1000);
   setDiagnosticMessage('Файл диагностики подготовлен.');
  }catch{setDiagnosticMessage('Не удалось подготовить файл диагностики.')}
 }
 useEffect(()=>{
  let live=true,wasUpdated=false;
  setInfo(null);setPhase('checking');
  const refresh=()=>setOnline(navigator.onLine);
  refresh();
  void getLocalGameSnapshotInfo(gameId,userId).then(value=>{
   if(!live||wasUpdated)return;
   setInfo(value);setPhase(value?'saved':'empty');
  });
  const updated=(event:Event)=>{
   const {detail}=event as CustomEvent<DeviceSnapshotEvent>;
   if(!live||detail?.gameId!==gameId||detail.userId!==userId)return;
   wasUpdated=true;
   setPhase(detail.status);
   if(detail.status==='saved'&&detail.info)setInfo(detail.info);
  };
  window.addEventListener(DEVICE_SNAPSHOT_EVENT,updated);
  window.addEventListener('online',refresh);window.addEventListener('offline',refresh);
  return()=>{live=false;window.removeEventListener(DEVICE_SNAPSHOT_EVENT,updated);
   window.removeEventListener('online',refresh);window.removeEventListener('offline',refresh)};
 },[gameId,userId]);
 const disconnected=!online;
 const label=disconnected?'Нет сети':phase==='saving'?'Сохраняем':
  phase==='saved'?'На устройстве':phase==='failed'?'Не сохранено':phase==='checking'?'Проверяем':'Загружаем';
 const explanation=disconnected?'Соединение отсутствует. Новые игровые действия требуют подключения к серверу.':
  realtimeState==='connected'?'Игровые изменения передаются по защищённому соединению.':'Синхронизация с сервером восстанавливается.';
 const title=label+' · ГОС.ID';
 const count=info?info.stages+info.metrics+info.events:0;
 return <details className={'deviceSyncStatus state-'+(disconnected?'offline':phase)}>
  <summary title={title} aria-label={'Данные на устройстве: '+label}>
   {disconnected?<WifiOff aria-hidden="true"/>:phase==='saved'?<Check aria-hidden="true"/>:
    phase==='saving'?<RefreshCw aria-hidden="true"/>:<CloudDownload aria-hidden="true"/>}
   <span className="deviceSyncLabel">{label}</span>
  </summary>
  <div className="deviceSyncDetails">
   <strong>Данные на этом устройстве</strong>
   <p>{phase==='saved'||info?
    'Локально сохранены опубликованные сведения. '+count+' записей: этапы, публичные показатели и события.':
    'Опубликованные сведения будут автоматически сохранены после загрузки из игры.'}</p>
   <p>{explanation}</p>
   <small>Голоса, оценки, права доступа и закрытые документы проверяются сервером. Локальная копия не заменяет синхронизацию.</small>
   <p className="deviceDiagnosticsInfo">Диагностика хранит последние 500 запросов только этой вкладки до её закрытия или обновления: время до ответа, название операции и код ответа. Тексты, пароли и адреса запросов не сохраняются.</p>
   <div className="deviceDiagnosticsActions"><button type="button" onClick={downloadDiagnostics}>Скачать диагностику</button><button type="button" onClick={()=>{clearRequestDiagnostics();setDiagnosticMessage('Журнал очищен.')}}>Очистить</button></div>
   <small aria-live="polite">{diagnosticMessage}</small>
  </div>
 </details>
}
