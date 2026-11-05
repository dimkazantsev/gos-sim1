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
   // Match the immutable published release where available. A new release
   // gets a fresh resource cache; old tabs are never forcibly reloaded.
   const release=process.env.NEXT_PUBLIC_GOS_RELEASE||process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA||'';
   const version=/^[0-9a-f]{40}$/i.test(release)?'?v='+release.toLowerCase():'';
   void navigator.serviceWorker.register(base+'/sw.js'+version,{scope:base+'/',updateViaCache:'none'}).catch(()=>{
    // PWA must never interfere with an online login or active game.
   });
  },2500)};
  if(document.readyState==='complete')register();
  else window.addEventListener('load',register,{once:true});
  return()=>{disposed=true;if(timer!==undefined)window.clearTimeout(timer);window.removeEventListener('load',register)};
 },[]);
 return null;
}
