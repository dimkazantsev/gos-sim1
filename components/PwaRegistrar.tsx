'use client';
import {useEffect} from 'react';

// Do not compete with login/bootstrap requests. Browsers keep the registration
// for subsequent launches; the worker only stores public immutable assets.
export default function PwaRegistrar(){
 useEffect(()=>{
  if(!('serviceWorker' in navigator)||window.location.protocol!=='https:')return;
  let timer:number|undefined,disposed=false;
  const register=()=>{timer=window.setTimeout(()=>{
   if(disposed)return;
   const base=(process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'').replace(/\/$/,'');
   void navigator.serviceWorker.register(base+'/sw.js',{scope:base+'/',updateViaCache:'none'}).catch(()=>{
    // PWA must never interfere with an online login or active game.
   });
  },2500)};
  if(document.readyState==='complete')register();
  else window.addEventListener('load',register,{once:true});
  return()=>{disposed=true;if(timer!==undefined)window.clearTimeout(timer);window.removeEventListener('load',register)};
 },[]);
 return null;
}
