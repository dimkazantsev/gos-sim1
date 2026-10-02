'use client';
import {useId,type CSSProperties} from 'react';
import {eventSceneFrame} from './eventSceneFrame';
import ComicSoundButton from './ComicSoundButton';
import type {EventComicScene} from './types';
import illustrations from '@/data/event-illustrations.json';
type Props={title:string;category:string;caseKey:string;compact?:boolean;silent?:boolean;scene?:EventComicScene|null};
function hash(s:string){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
export default function EventComic({title,category,caseKey,compact=false,silent=false,scene}:Props){
 const id=useId().replace(/:/g,'');
 const art=(illustrations as Record<string,{src:string;srcSet:string;width:number;height:number}>)[caseKey];
 const base=process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'';
 if(art)return <div className="eventComicPlayer"><figure data-scene={Number(art.src.match(/scene-(\d+)/)?.[1])} className={'eventComic eventPanelIllustration cinematicRaster '+(compact?'isCompact':'')}><img src={base+art.src} srcSet={art.srcSet.split(', ').map(s=>base+s).join(', ')} data-case={caseKey} data-scene={Number(art.src.match(/scene-(\d+)/)?.[1])} sizes={compact?'(max-width:650px) 92vw, (max-width:1100px) 45vw, 360px':'(max-width:900px) 96vw, 1000px'} width={1920} height={1080} alt={scene?.alt||'Иллюстрация ситуации «'+title+'»'} loading={compact?'lazy':'eager'} decoding="async"/></figure>{!silent&&<ComicSoundButton/>}</div>;
 const frame=eventSceneFrame(caseKey);
 const sceneId=frame?('scene-'+String(frame.number).padStart(2,'0')):scene?.scene_id;
 if(sceneId&&/^scene-\d{2,4}$/.test(String(sceneId)))return <div className="eventComicPlayer">
 <figure className={'eventComic eventPanelIllustration '+(compact?'isCompact':'')} style={{'--scene-native-width':'1920px','--scene-ratio':'16/9'} as CSSProperties} role="img" aria-label={scene?.alt||'Иллюстрация ситуации «'+title+'»'}>
 <svg width="1920" height="1080" viewBox="0 0 1920 1080" data-scene={Number(String(sceneId).replace('scene-',''))} preserveAspectRatio="xMidYMid meet" aria-hidden="true" style={{overflow:'hidden'}}>
 <defs><clipPath id={'vectorScene_'+String(sceneId)+'_'+id}><rect width="1920" height="1080"/></clipPath></defs>
 <g clipPath={'url(#vectorScene_'+String(sceneId)+'_'+id+')'}><image href={'/event-comics/'+String(sceneId)+'.svg'} width="1920" height="1080" preserveAspectRatio="xMidYMid meet"/></g>
 </svg></figure>{!silent&&<ComicSoundButton/>}</div>;
 const seed=hash(caseKey||title),kind=(()=>{const t=(title+' '+category).toLowerCase();
 if(/больниц|клиник|врач|скор|лекарств|инсулин|медицин/.test(t))return 'hospital';
 if(/школ|экзамен|университет|студент|образован|учени|язык/.test(t))return 'school';
 if(/мост|дорог|автобус|транспорт|маршрут|остановк/.test(t))return 'transport';
 if(/рек|лес|гриб|дамб|пожар|эколог|воздух|вод|озелен/.test(t))return 'nature';
 if(/бюджет|банков|смет|карьер|грант|закуп|предприят|эконом/.test(t))return 'industry';
 if(/кибер|интернет|электросет|реестр|цифров|информац|фейк/.test(t))return 'digital';
 if(/музей|театр|фестиваль|хор|памятник|скульп|сувенир|культур|музык/.test(t))return 'culture';
 if(/кот|собак|живот|рыба|ветеринар|аксолотль/.test(t))return 'animals';
 if(/голосован|депутат|комисси|конфликт|референдум|граждан|повестк|совет/.test(t))return 'parliament';
 return 'city';
 })();
 const colors=[
  ['#202d61','#5269b8','#fa936f','#ffe0a2'],
  ['#123d5a','#3a8aaf','#f3b067','#ffebaa'],
  ['#312759','#7964b6','#f18ba7','#fce4b1'],
  ['#174e59','#53a79e','#dbe4a1','#fff0bf'],
  ['#3a344b','#a26972','#f8a979','#ffe3b5']
 ][seed%5];
 const [night,mid,warm,light]=colors;
 const shift=seed%58,personColor=['#8cf2d2','#ffb7b2','#aabfff','#ffe1a2'][seed%4];
 return <div className="eventComicPlayer"><div className={'eventComic '+(compact?'isCompact':'')} role="img" aria-label={'Комикс-иллюстрация к событию «'+title+'»'}>
 <svg viewBox="0 0 680 350" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
 <defs><linearGradient id={'sky'+id} x2="0.85" y2="1"><stop stopColor={night}/><stop offset=".62" stopColor={mid}/><stop offset="1" stopColor={warm}/></linearGradient>
 <linearGradient id={'floor'+id} x2="0" y2="1"><stop stopColor="#213450"/><stop offset="1" stopColor="#102139"/></linearGradient></defs>
 <rect width="680" height="350" fill={'url(#sky'+id+')'}/>
 <circle cx={475+shift} cy={94+(seed%20)} r={65+seed%15} fill={light} opacity=".63"/>
 <path d="M0 191Q90 144 173 173T346 168Q450 125 529 170T680 151V350H0Z" fill={night} opacity=".34"/>
 {kind==='nature'?<g>
  <path d={'M0 278Q120 '+(176+shift)+' 244 243T490 229T680 221V350H0Z'} fill="#244f67"/><path d="M-40 306Q220 257 450 301T750 260" stroke="#91dce2" strokeWidth="25" fill="none"/>
  {Array.from({length:8},(_,i)=><g key={i} transform={'translate('+(i*95-24+shift%33)+','+(182+i%3*27)+')'}><path d="M0 92V5" stroke="#263b40" strokeWidth="11"/><path d="M-30 52 0 2 28 52Zm-24-18L0-21 23 34Z" fill={i%2?'#9dc0a3':'#64b99f'}/></g>)}
 </g>:kind==='hospital'?<g>
  <path d="M140 314V122H528V314" fill="#ecf3f5" stroke="#173959" strokeWidth="9"/><rect x="270" y="94" width="120" height="61" rx="4" fill="#d1e4f3"/><path d="M323 108v32m-16-16h32" stroke="#e96771" strokeWidth="11"/>
  {Array.from({length:8},(_,i)=><rect key={i} x={174+(i%4)*89} y={167+Math.floor(i/4)*66} width="48" height="38" fill="#91bcd4" stroke="#4f8199" strokeWidth="4"/>)}
  <rect x="302" y="257" width="61" height="57" fill="#4f87ad"/><path d="M350 307q95-25 162-5" stroke="#f9f8e6" strokeWidth="13"/>
 </g>:kind==='school'?<g>
  <path d="M102 164 340 65 574 164V316H102Z" fill="#eadfca" stroke="#3b4770" strokeWidth="9"/><rect x="295" y="237" width="90" height="78" fill="#6788a6"/>
  {Array.from({length:8},(_,i)=><rect key={i} x={147+(i%4)*107} y={173+Math.floor(i/4)*59} width="56" height="42" fill="#98c8d8" stroke="#567b95" strokeWidth="5"/>)}
  <path d="M280 153h118" stroke="#f19c75" strokeWidth="12"/><path d="M328 80v-37h7v35" stroke="#f6efe1" strokeWidth="6"/>
 </g>:kind==='transport'?<g>
  <path d="M-30 331 330 255 740 325" fill="none" stroke="#2d3d59" strokeWidth="64"/><path d="M-30 331 330 255 740 325" fill="none" stroke="#eae8e3" strokeDasharray="25 23" strokeWidth="5"/>
  <path d="M82 185H585L559 284H111Z" fill="#f0e8d8" stroke="#2e4d6b" strokeWidth="8"/>
  {Array.from({length:7},(_,i)=><rect key={i} x={128+i*61} y="201" width="44" height="49" rx="5" fill="#6a9abb"/>)}
  <circle cx="178" cy="286" r="23" fill="#172d48" stroke="#e9d8b4" strokeWidth="7"/><circle cx="490" cy="286" r="23" fill="#172d48" stroke="#e9d8b4" strokeWidth="7"/>
 </g>:kind==='digital'?<g>
  <rect x="146" y="110" width="378" height="196" rx="16" fill="#162b4c" stroke="#74cbd2" strokeWidth="10"/>
  {Array.from({length:3},(_,i)=><g key={i}><rect x={183+i*109} y="150" width="83" height="105" rx="5" fill="#36537c" stroke="#5a9fbe" strokeWidth="4"/>{Array.from({length:5},(_,j)=><circle key={j} cx={200+i*109+(j%2)*39} cy={168+Math.floor(j/2)*27} r="4" fill={j%2?warm:'#88ead0'}/>)}</g>)}
  <path d="m130 286 85-75 82 30 96-111 105 92 69-55" stroke={warm} strokeWidth="8" fill="none" opacity=".8"/>
 </g>:kind==='industry'?<g>
  <path d="M80 306V201l90 47v-47l97 48v-86h198v143Z" fill="#667188" stroke="#29334e" strokeWidth="10"/>
  <path d="M280 160V70h57v90m90 3V92h39v71" fill="#a1a9aa" stroke="#36415e" strokeWidth="7"/>
  {Array.from({length:6},(_,i)=><rect key={i} x={117+i*69} y={260} width="40" height="34" fill="#fbc17b"/>)}
  <g opacity=".6" fill="#e1e5f2"><ellipse cx="306" cy="54" rx="30" ry="16"/><ellipse cx="460" cy="70" rx="38" ry="19"/></g>
 </g>:kind==='culture'?<g>
  <path d="M97 138h490v170H97Z" fill="#dbaca5" stroke="#3d3c69" strokeWidth="11"/>
  <path d="M98 138Q221 216 340 138Q459 215 586 138V258Q460 178 340 256Q218 178 98 258Z" fill="#d05c7c"/>
  <path d="M210 295h256" stroke="#ffeab7" strokeWidth="12"/><circle cx="209" cy="166" r="15" fill="#f9e6a8"/><circle cx="469" cy="166" r="15" fill="#f9e6a8"/>
  {Array.from({length:5},(_,i)=><path key={i} d={'M'+(210+i*58)+' 288v-45q18-35 35 0v45'} fill="#4b6fa3"/>)}
 </g>:kind==='animals'?<g>
  <path d="M85 308V221H586V308Z" fill="#efdfc4"/><ellipse cx="344" cy="243" rx="151" ry="80" fill="#eec5ae"/>
  <path d="m255 209-25-92 79 69m101 23 36-91-91 65" fill="#eec5ae"/><ellipse cx="294" cy="237" rx="10" ry="15" fill="#283451"/><ellipse cx="395" cy="237" rx="10" ry="15" fill="#283451"/><path d="m333 263q12 20 28 0" fill="none" stroke="#854c55" strokeWidth="7"/>
  <path d="m100 302 20-44 44 31 22-43" stroke="#85c0aa" strokeWidth="15" fill="none"/>
 </g>:<g>
  <path d="M98 307V168H574V307Z" fill="#d9d8d8" stroke="#364366" strokeWidth="10"/>
  <path d="M66 173 337 83 606 173Z" fill="#e2e2db" stroke="#3f486f" strokeWidth="11"/>
  {Array.from({length:7},(_,i)=><rect key={i} x={135+i*62} y="193" width="35" height="90" fill="#7c95a8"/>)}
  <path d="M60 308h542" stroke="#e0e7e3" strokeWidth="14"/>
 </g>}
 <path d="M0 318Q150 290 330 315T680 303V350H0Z" fill={'url(#floor'+id+')'}/>
 <g transform={'translate('+(83+shift)+','+(260-seed%33)+')'}>
  <circle cx="0" cy="0" r="16" fill="#f8c99e"/><path d="M-30 73Q-30 22-3 20Q28 22 29 73Z" fill={personColor}/><path d="M-3 34-50 7M13 36 55 13" stroke={personColor} strokeWidth="12" strokeLinecap="round"/>
 </g>
 <g transform={'translate('+(568-shift/3)+','+(263+seed%17)+')'}>
  <circle cx="0" cy="0" r="17" fill="#cba58d"/><path d="M-27 69Q-27 25 0 23Q27 26 28 69Z" fill={seed%2?'#e7b6d6':'#8acecd'}/><path d="M-2 35-38 20M11 35 46 7" stroke={seed%2?'#e7b6d6':'#8acecd'} strokeWidth="10" strokeLinecap="round"/>
 </g>
 <path d="M0 1H680V350H0Z" fill="none" stroke="#fff" strokeOpacity=".23" strokeWidth="11"/>
 </svg>
 <div className="eventComicCaption"><span>GOS//SIMS</span><strong>{title}</strong><small>Авторская иллюстрация учебного сценария</small></div>
 </div>{!silent&&<ComicSoundButton/>}</div>;
}
