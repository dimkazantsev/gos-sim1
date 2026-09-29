'use client';
import {useRef,useState} from 'react';
import {Maximize2,Pause,Play} from 'lucide-react';
export default function ChatVideoNote({src,preview=false}:{src:string;preview?:boolean}){
 const ref=useRef<HTMLVideoElement>(null);
 const [playing,setPlaying]=useState(false);
 const [duration,setDuration]=useState<number|null>(null);
 function toggle(){const v=ref.current;if(!v)return;if(v.paused){void v.play().catch(()=>setPlaying(false))}else v.pause()}
 return <div className={'chatVideoNote '+(preview?'isPreview':'')} role="group" aria-label="Круглое видеосообщение">
  <video ref={ref} src={src} playsInline preload="metadata" onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:null)}
    onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
    onClick={toggle} aria-label="Круглое видео"/>
  <button type="button" className="chatVideoPlay" onClick={toggle} aria-label={playing?'Приостановить видео':'Воспроизвести видео'}>
    {playing?<Pause size={22} fill="currentColor" aria-hidden="true"/>:<Play size={23} fill="currentColor" aria-hidden="true"/>}
  </button>
  <span className="chatVideoDuration" aria-live="off">{duration===null?'Видео':Math.floor(duration/60)+':'+String(Math.floor(duration%60)).padStart(2,'0')}</span>
  <button type="button" className="chatVideoFullscreen" onClick={()=>{const v=ref.current;if(v?.requestFullscreen)void v.requestFullscreen()}}
   aria-label="Развернуть видео на весь экран"><Maximize2 size={16}/></button>
 </div>;
}
