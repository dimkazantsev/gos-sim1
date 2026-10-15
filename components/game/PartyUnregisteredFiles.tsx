'use client';
import {useCallback,useEffect,useState} from 'react';
import {RefreshCw,ExternalLink} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {PartyDocument} from './types';

type Unregistered={name:string;path:string;url:string};
export default function PartyUnregisteredFiles({gameId,partyId,registered}:{gameId:string;partyId:string;registered:PartyDocument[]}){
 const [files,setFiles]=useState<Unregistered[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const refresh=useCallback(async()=>{
  setBusy(true);setError('');
  const prefix=gameId+'/parties/'+partyId+'/docs';
  try{
   const {data,error:listError}=await supabase.storage.from('game-assets').list(prefix,{limit:100,sortBy:{column:'created_at',order:'desc'}});
   if(listError)throw listError;
   const known=new Set(registered.map(d=>d.storage_path));
   const missing=(data||[]).filter(item=>item.name&&!known.has(prefix+'/'+item.name));
   const signed=await Promise.all(missing.map(async item=>{
    const path=prefix+'/'+item.name;
    const result=await supabase.storage.from('game-assets').createSignedUrl(path,3600);
    return result.error?null:{name:item.name,path,url:result.data?.signedUrl||''};
   }));
   setFiles(signed.filter((file):file is Unregistered=>!!file));
  }catch(e){setError(e instanceof Error?e.message:'Не удалось прочитать хранилище файлов.')}
  finally{setBusy(false);setLoaded(true)}
 },[gameId,partyId,registered]);
 useEffect(()=>{void refresh()},[refresh]);
 if(!loaded&&busy)return <small>Проверка файлов в хранилище…</small>;
 return <section aria-label="Файлы без регистрации" className="teacherPartySection">
  <h4>Файлы без записи в реестре {files.length>0?'('+files.length+')':''}</h4>
  <p className="teacherPartyMuted">Supabase Storage → game-assets → {gameId}/parties/{partyId}/docs/. Эти файлы не считаются поданными документами до регистрации в реестре.</p>
  {files.length>0?<ul>{files.map(f=><li key={f.path}><span>{f.name}<small>Файл загружен, запись документа отсутствует</small></span>{f.url&&<a href={f.url} target="_blank" rel="noreferrer" aria-label={'Открыть файл '+f.name}><ExternalLink size={16}/></a>}</li>)}</ul>:<p className="teacherPartyMuted">Незарегистрированные файлы не обнаружены.</p>}
  {error&&<p role="alert">{error}</p>}
  <button type="button" className="secondary" onClick={()=>void refresh()} disabled={busy}><RefreshCw size={14}/>{busy?'Проверка…':'Проверить хранилище'}</button>
 </section>;
}
