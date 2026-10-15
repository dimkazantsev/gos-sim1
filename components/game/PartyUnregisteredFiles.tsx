'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {RefreshCw,ExternalLink} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {PartyDocument} from './types';

type Unregistered={name:string;path:string;url:string};
export default function PartyUnregisteredFiles({gameId,partyId,registered}:{gameId:string;partyId:string;registered:PartyDocument[]}){
 const [files,setFiles]=useState<Unregistered[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const latestRequest=useRef(0);
 // Compare document paths, not the new array created on every parent render.
 const registeredPaths=registered.map(d=>d.storage_path).sort().join('\n');
 const refresh=useCallback(async()=>{
  const request=++latestRequest.current;
  setBusy(true);setError('');
  const prefix=gameId+'/parties/'+partyId+'/docs';
  try{
   const {data,error:listError}=await supabase.storage.from('game-assets').list(prefix,{limit:100,sortBy:{column:'created_at',order:'desc'}});
   if(listError)throw listError;
   const known=new Set(registeredPaths?registeredPaths.split('\n'):[]);
   const missing=(data||[]).filter(item=>item.name&&!known.has(prefix+'/'+item.name));
   const signed=await Promise.all(missing.map(async item=>{
    const path=prefix+'/'+item.name;
    const result=await supabase.storage.from('game-assets').createSignedUrl(path,3600);
    return result.error?null:{name:item.name,path,url:result.data?.signedUrl||''};
   }));
   if(request===latestRequest.current)setFiles(signed.filter((file):file is Unregistered=>!!file));
  }catch(e){if(request===latestRequest.current)setError(e instanceof Error?e.message:'Не удалось прочитать хранилище файлов.')}
  finally{if(request===latestRequest.current){setBusy(false);setLoaded(true)}}
 },[gameId,partyId,registeredPaths]);
 useEffect(()=>{void refresh();return ()=>{latestRequest.current++}},[refresh]);
 return <section aria-label="Файлы без регистрации" className="teacherPartySection">
  <h4>Файлы без записи в реестре {files.length>0?'('+files.length+')':''}</h4>
  <p className="teacherPartyMuted">Supabase Storage → game-assets → {gameId}/parties/{partyId}/docs/. Эти файлы не считаются поданными документами до регистрации в реестре.</p>
  {!loaded&&<p className="teacherPartyMuted" role="status">Проверка файлов в хранилище…</p>}
  {loaded&&files.length>0?<ul>{files.map(f=><li key={f.path}><span>{f.name}<small>Файл загружен, запись документа отсутствует</small></span>{f.url&&<a href={f.url} target="_blank" rel="noreferrer" aria-label={'Открыть файл '+f.name}><ExternalLink size={16}/></a>}</li>)}</ul>:loaded?<p className="teacherPartyMuted">Незарегистрированные файлы не обнаружены.</p>:null}
  {error&&<p role="alert">{error}</p>}
  <button type="button" className="secondary" onClick={()=>void refresh()} disabled={busy} aria-busy={busy}><RefreshCw size={14} aria-hidden="true"/>Проверить хранилище</button>
 </section>;
}
