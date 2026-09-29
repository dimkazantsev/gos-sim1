'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Pause,Play,Volume2,VolumeX,X} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
const SCENES=[
 {kicker:'ПРОЛОГ · ДЕНЬ НОЛЬ',title:'Республика После Бури',body:'Вы пришли к власти не в идеальном государстве. Заводы простаивают, мосты требуют ремонта, бюджет трещит по швам, а граждане больше не верят красивым обещаниям.',stamp:'ДОВЕРИЕ: КРИТИЧЕСКОЕ',caption:'Начало не будет лёгким.'},
 {kicker:'ГЛАВА 01 · ПЕРВЫЙ СИГНАЛ',title:'Казна Почти Пуста',body:'У вас есть кабинеты, законы, партии и огромное количество вопросов. Деньги заканчиваются быстрее совещаний. Каждая программа забирает ресурсы у другой.',stamp:'РЕСУРСЫ: ОГРАНИЧЕНЫ',caption:'Цена любого решения реальна — хотя республика и вымышленная.'},
 {kicker:'ГЛАВА 02 · НОВЫЕ ИГРОКИ',title:'Люди Требуют Ответа',body:'Одни требуют рабочих мест. Другие — защиты природы. Третьи хотят мира и порядка. Интересы противоречат друг другу, а коалиции появляются и распадаются.',stamp:'КОНФЛИКТ ИНТЕРЕСОВ',caption:'Договариваться придётся даже с оппонентами.'},
 {kicker:'ВАШ ХОД · РЕСПУБЛИКА',title:'Теперь Решаете Вы',body:'Создавайте партии, собирайте большинство, готовьте документы, отвечайте на кризисы и восстанавливайте доверие граждан. Здесь история меняется с каждым вашим шагом.',stamp:'НАЧАТЬ ВОССТАНОВЛЕНИЕ',caption:'16 этапов. Одно общее государство. Много разных решений.'}
];
function Artwork({scene}:{scene:number}){
 return <svg className={'comicArtwork s'+scene} viewBox="0 0 900 510" role="img" aria-label={SCENES[scene].title} preserveAspectRatio="xMidYMid slice">
  <defs>
   <linearGradient id="comicNight" x1="0" y1="0" x2="1" y2="1"><stop stopColor={scene===3?'#0c3d7d':'#101837'}/><stop offset=".55" stopColor={scene===3?'#2275b1':'#442e73'}/><stop offset="1" stopColor={scene===3?'#ffc46f':'#fc665d'}/></linearGradient>
   <linearGradient id="comicCity" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#314d74"/><stop offset="1" stopColor="#111b3c"/></linearGradient>
   <radialGradient id="comicGlow"><stop stopColor="#ffe78a" stopOpacity="1"/><stop offset="1" stopColor="#ff9a6b" stopOpacity="0"/></radialGradient>
  </defs>
  <rect width="900" height="510" fill="url(#comicNight)"/>
  <g className="comicCelestial"><circle cx={scene===3?713:722} cy={scene===3?158:155} r={scene===3?142:95} fill="url(#comicGlow)"/><circle cx={scene===3?713:722} cy={scene===3?158:155} r={scene===3?52:33} fill="#fff0a3"/></g>
  <g className="comicClouds" fill="#1b254f" opacity=".55"><ellipse cx="135" cy="125" rx="180" ry="50"/><ellipse cx="449" cy="64" rx="172" ry="38"/><ellipse cx="775" cy="120" rx="155" ry="44"/></g>
  <g className="comicHills" fill="#23365e"><path d="M0 365 141 259 246 306 346 240 455 332 554 260 663 325 798 234 900 290V510H0Z"/></g>
  <g className="comicBuildings" fill="url(#comicCity)" stroke="#10162d" strokeWidth="5">
   <path d="M0 509V305H102V509ZM129 509V236H207V509ZM226 509V312H299V509ZM319 509V199H400V509ZM427 509V281H534V509ZM549 509V227H628V509ZM650 509V311H747V509ZM764 509V265H900V509Z"/>
  </g>
  <g fill={scene===3?'#80f5d5':'#e9b96c'} opacity={scene===3?'.95':'.40'}>
   {Array.from({length:26},(_,i)=><rect key={i} x={16+(i%9)*94} y={320+Math.floor(i/9)*52} width="13" height="21" rx="2"/>)}
  </g>
  {scene<3&&<g className="comicBroken" fill="#181d3c"><path d="M318 199 343 160 365 196 390 180 400 199Z"/><path d="M143 236 155 207 169 227 181 196 196 236Z"/><path d="M760 266 791 223 819 251 833 217 853 265Z"/></g>}
  {scene===0&&<g className="comicStorm" fill="none" stroke="#d2deff" strokeWidth="2" opacity=".55">
    {Array.from({length:19},(_,i)=><path key={i} d={'m'+(i*53-70)+' '+(i%3*59+8)+' -40 95'}/>)}
   <path stroke="#fff3b0" strokeWidth="10" d="m520 35-40 92 32-6-42 88"/></g>}
  {scene===0&&<g className="comicEmergency">
    <path d="M0 405q155-48 260-16t295-13t360 14" stroke="#607fa4" strokeWidth="33" fill="none"/>
    <path d="M80 411h155v-58H80l23-45h89l36 45h25v58Z" fill="#e2e5d9" stroke="#213453" strokeWidth="8"/>
    <path d="M146 323v30m-16-15h32" stroke="#ff6874" strokeWidth="12"/>
    <circle cx="114" cy="410" r="18" fill="#141e31"/><circle cx="213" cy="410" r="18" fill="#141e31"/>
    <path d="m354 354 33-65 63 48 54-33 32 64" stroke="#f7c2a7" strokeWidth="13" fill="none"/>
    <g strokeWidth="11" fill="none" strokeLinecap="round"><path d="M545 398q30-46 57 0" stroke="#a9ffdc"/><path d="M560 362v-40" stroke="#a9ffdc"/></g>
   </g>}
  {scene===1&&<g className="comicVault">
    <rect x="302" y="226" width="274" height="244" rx="20" fill="#263354" stroke="#f7c87b" strokeWidth="8"/>
    <circle cx="440" cy="343" r="88" fill="#1c2548" stroke="#9faec8" strokeWidth="12"/>
    <circle cx="440" cy="343" r="39" fill="#54617b" stroke="#ffdb8c" strokeWidth="7"/>
    <path d="M440 295v96m-48-48h96m-82-33 68 68m-1-69-67 69" stroke="#ffd38c" strokeWidth="9" strokeLinecap="round"/>
    <path d="M320 238H558" stroke="#f5a26d" strokeWidth="5" strokeDasharray="12 12"/></g>}
  {scene===2&&<g className="comicCrowd">
   {Array.from({length:14},(_,i)=><g key={i} transform={'translate('+(30+i*65)+','+(340+(i%3)*26)+')'}>
    <circle cx="0" cy="0" r="18" fill={i%3===0?'#ffd5a7':'#9bd6f9'}/>
    <path d="M-26 68Q-28 22 0 21Q29 22 27 68Z" fill={i%2?'#6a74ff':'#f6708c'}/>
   </g>)}
   <path d="M340 239h225v87H340Z" fill="#fce6bc" stroke="#342c56" strokeWidth="7" transform="rotate(-7 450 275)"/>
   <text x="361" y="286" fontSize="28" fontWeight="900" fill="#172b53" transform="rotate(-7 450 275)">ГДЕ РЕШЕНИЯ?</text></g>}
  {scene===3&&<g className="comicRebirth">
   <path d="M270 509 420 225 505 509" fill="#223f6f" stroke="#93ffd5" strokeWidth="10"/>
   <path d="M304 508 420 285 465 508" fill="#70c9d6" opacity=".85"/>
   <path d="m420 226 0-105" stroke="#fcf6dc" strokeWidth="12"/>
   <path d="M426 118Q520 91 587 148Q513 196 426 175Z" fill="#51e7c9"/>
   <path d="M-10 474Q290 365 559 450T930 418" fill="none" stroke="#f4e79d" strokeWidth="12" strokeLinecap="round"/>
   <g fill="#e8fff7">{Array.from({length:12},(_,i)=><circle key={i} cx={55+i*75} cy={75+i%4*28} r={3+i%3}/>)}</g>
  </g>}
  <path d="M0 509V474Q100 468 200 479T400 472T600 481T900 461V509Z" fill="#111d35"/>
 </svg>;
}
export default function RepublicComic({open,onClose,intro=false}:{open:boolean;onClose:()=>void;intro?:boolean}){
 const [scene,setScene]=useState(0),[playing,setPlaying]=useState(true),[audio,setAudio]=useState(false);
 const audioRef=useRef<AudioContext|null>(null);
 const sourceRef=useRef<AudioBufferSourceNode|null>(null);
 const close=()=>{if(!intro||scene===SCENES.length-1)onClose()};
 const dialog=useDialog(open,close);
 function startSound(){
  try{
   const ctx=audioRef.current||(audioRef.current=new AudioContext({sampleRate:22050}));
   void ctx.resume();
   if(sourceRef.current)return;
   // A 36-second atmospheric score. Fade-out and fade-in meet at silence to prevent clicks.
   const length=ctx.sampleRate*36,buffer=ctx.createBuffer(1,length,ctx.sampleRate),samples=buffer.getChannelData(0);
   const notes=[65.41,73.42,82.41,98,87.31,82.41,73.42,65.41,61.74];
   for(let i=0;i<length;i++){
    const t=i/ctx.sampleRate,n=notes[Math.floor(t/4)%notes.length];
    const fade=Math.min(1,t/1.4,(36-t)/1.4);
    const beat=Math.exp(-((t%2)*4))*.15*Math.sin(2*Math.PI*44*t);
    const drone=.16*Math.sin(2*Math.PI*n*t)+.10*Math.sin(2*Math.PI*(n/2)*t)+.035*Math.sin(2*Math.PI*1.7*t)*Math.sin(2*Math.PI*(n*1.5)*t);
    samples[i]=Math.max(-.35,Math.min(.35,(drone+beat)*Math.max(0,fade)));
   }
   const node=ctx.createBufferSource(),gain=ctx.createGain();node.buffer=buffer;node.loop=true;node.loopStart=0;node.loopEnd=36;
   gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.linearRampToValueAtTime(.4,ctx.currentTime+.7);
   node.connect(gain);gain.connect(ctx.destination);node.start();sourceRef.current=node;
  }catch{/* Sound can require explicit permission; the comic remains readable. */}
 }
 function stopSound(){try{sourceRef.current?.stop()}catch{}sourceRef.current?.disconnect();sourceRef.current=null}
 function toggleAudio(){if(audio){stopSound();setAudio(false)}else{startSound();setAudio(true)}}
 function go(index:number){const n=Math.max(0,Math.min(SCENES.length-1,index));setScene(n)}
 useEffect(()=>{
  if(!open||!playing)return;
  const timer=window.setTimeout(()=>{
   if(scene===SCENES.length-1){if(intro)onClose();else setScene(0)}
   else setScene(scene+1);
  },8200);
  return()=>window.clearTimeout(timer);
 },[open,playing,scene,intro,onClose]);
 useEffect(()=>{if(open){setScene(0);setPlaying(true)}else stopSound()},[open]);
 useEffect(()=>()=>{stopSound();void audioRef.current?.close()},[]);
  if(!open)return null;
 const item=SCENES[scene];
 return <div className="comicBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!intro)close()}}>
  <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Комикс о Республике" className="comicDialog">
   <header><b>GOS//SIMS · КОМИКС О РЕСПУБЛИКЕ</b><div><button aria-label={audio?'Выключить звук':'Включить звук'} onClick={toggleAudio}>{audio?<Volume2 size={19}/>:<VolumeX size={19}/>}</button>
     <button aria-label={playing?'Остановить автоматическое воспроизведение':'Продолжить показ'} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>
     <button aria-label={intro?'Завершить пролог после просмотра':'Закрыть комикс'} disabled={intro&&scene!==SCENES.length-1} onClick={close}><X size={20}/></button></div></header>
   <div className="comicFrame" key={scene}><Artwork scene={scene}/><div className="comicOverlay">
    <span className="comicKicker">{item.kicker}</span><h2>{item.title}</h2><p>{item.body}</p><strong>{item.stamp}</strong>
   </div></div>
   <footer><div className="comicFooterLabel"><small>{item.caption}{intro?' · После пролога откроется обязательная настройка профиля.':''}</small><span>{String(scene+1).padStart(2,'0')} / {String(SCENES.length).padStart(2,'0')}</span></div>
    <div className="comicControls"><button onClick={()=>go(scene-1)} aria-label="Предыдущая сцена"><ArrowLeft size={18}/></button>
    {SCENES.map((x,i)=><button key={i} className={'comicDot '+(scene===i?'active':'')} aria-current={scene===i?'step':undefined} aria-label={'Сцена '+(i+1)+': '+x.title} onClick={()=>go(i)}>{String(i+1).padStart(2,'0')}</button>)}
    <button onClick={()=>scene===SCENES.length-1?close():go(scene+1)} aria-label={scene===SCENES.length-1?'Завершить просмотр':'Следующая сцена'}><ArrowRight size={18}/></button></div></footer>
  </section></div>;
}
