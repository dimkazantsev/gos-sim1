'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowDownToLine,Pause,Play} from 'lucide-react';
import {normalizeVoiceWaveform} from './voiceWaveform';

/** Stable decorative waveform. The slider above it represents real playback
 * position; bars are not falsely presented as measured audio amplitudes. */
const WAVE=[36,54,40,77,62,42,83,50,68,94,57,42,76,65,48,86,55,72,38,63,91,53,73,44,82,55,69,37,78,51,64,88,46,71,58,83];
const SPEEDS=[1,1.5,2] as const;

export function voiceClock(seconds:number):string{
 if(!Number.isFinite(seconds)||seconds<0)return '0:00';
 const s=Math.floor(seconds);
 return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
}
export function voiceProgress(elapsed:number,duration:number):number{
 return duration>0&&Number.isFinite(duration)?Math.min(100,Math.max(0,elapsed/duration*100)):0;
}

export default function ChatVoicePlayer({
 src,messageId,durationHint=0,waveform,fileName='Аудиосообщение',
}:{src:string;messageId:string;durationHint?:number|null;waveform?:number[]|null;fileName?:string}){
 const audio=useRef<HTMLAudioElement>(null);
 const [playing,setPlaying]=useState(false);
 const [elapsed,setElapsed]=useState(0);
 const [mediaDuration,setMediaDuration]=useState(0);
 const [speed,setSpeed]=useState<number>(1);
 const [failed,setFailed]=useState(false);
 const [buffering,setBuffering]=useState(false);
 const duration=mediaDuration>0?mediaDuration:(durationHint&&durationHint>0?durationHint:0);
 const progress=voiceProgress(elapsed,duration);
 const bars=useMemo(()=>normalizeVoiceWaveform(waveform)||WAVE,[waveform]);
 useEffect(()=>{
  setPlaying(false);setElapsed(0);setMediaDuration(0);setFailed(false);setBuffering(false);
  const node=audio.current;
  if(node){node.pause();node.playbackRate=1;}
  setSpeed(1);
 },[src]);
 function syncDuration(){
  const node=audio.current;
  if(node&&Number.isFinite(node.duration)&&node.duration>0)setMediaDuration(node.duration);
 }
 function pauseOtherVoices(){
  document.querySelectorAll<HTMLAudioElement>('audio[data-chat-voice]').forEach(el=>{
   if(el!==audio.current&&!el.paused)el.pause();
  });
 }
 async function toggle(){
  const node=audio.current;if(!node)return;
  if(!node.paused){node.pause();return}
  setFailed(false);setBuffering(true);
  pauseOtherVoices();
  try{await node.play()}catch{setFailed(true);setPlaying(false);setBuffering(false)}
 }
 function seek(next:number){
  const node=audio.current;
  if(!node||duration<=0)return;
  const time=Math.max(0,Math.min(duration,next));
  try{node.currentTime=time;setElapsed(time)}catch{/* Metadata unavailable: retain current position. */}
 }
 function cycleSpeed(){
  const next=SPEEDS[(SPEEDS.indexOf(speed as typeof SPEEDS[number])+1)%SPEEDS.length];
  if(audio.current)audio.current.playbackRate=next;
  setSpeed(next);
 }
 return <div className="chatVoicePlayer" data-chat-voice-player={messageId} aria-label="Голосовое сообщение">
  <audio ref={audio} data-chat-voice="" preload="metadata" src={src}
   onLoadedMetadata={syncDuration} onDurationChange={syncDuration}
   onPlay={()=>{pauseOtherVoices();setPlaying(true);setBuffering(false)}}
   onPause={()=>setPlaying(false)}
   onWaiting={()=>setBuffering(true)}
   onCanPlay={()=>setBuffering(false)}
   onTimeUpdate={e=>{setElapsed(e.currentTarget.currentTime);syncDuration()}}
   onRateChange={e=>setSpeed(e.currentTarget.playbackRate)}
   onEnded={e=>{setPlaying(false);setBuffering(false);if(!duration)setMediaDuration(e.currentTarget.currentTime);setElapsed(0)}}
   onError={()=>{setFailed(true);setPlaying(false);setBuffering(false)}}/>
  <button type="button" className="chatVoicePlay"
   aria-label={playing?'Пауза голосового сообщения':'Воспроизвести голосовое сообщение'}
   title={playing?'Пауза':'Воспроизвести'} onClick={()=>void toggle()}>
   {playing?<Pause aria-hidden="true" size={18} fill="currentColor"/>:<Play aria-hidden="true" size={18} fill="currentColor"/>}
  </button>
  <div className="chatVoiceTrack">
   <div className="chatVoiceWave" aria-hidden="true">
    {bars.map((height,i)=><span key={i} className={((i+.5)/bars.length*100)<=progress?'played':''} style={{height:height+'%'}}/>)}
   </div>
   <input className="chatVoiceSeek" aria-label="Перемотка голосового сообщения"
    title="Перемотка" type="range" min={0} max={duration||1} step={0.1}
    disabled={duration<=0} value={Math.min(elapsed,duration||1)}
    onChange={e=>seek(Number(e.currentTarget.value))}/>
   <div className="chatVoiceMeta">
    <time>{voiceClock(elapsed)}{duration>0?' / '+voiceClock(duration):''}</time>
    {buffering&&!failed&&<span className="chatVoiceBuffering" role="status">Загрузка…</span>}
    {failed&&<span className="chatVoiceError" role="alert">Не удалось воспроизвести</span>}
    <a href={src} download={fileName} aria-label="Скачать аудиосообщение"
     title="Скачать" className="chatVoiceDownload"><ArrowDownToLine aria-hidden="true" size={15}/></a>
   </div>
  </div>
  <button className="chatVoiceSpeed" type="button" aria-label={'Скорость '+speed+'×. Изменить'}
   title="Скорость воспроизведения" onClick={cycleSpeed}>{speed}×</button>
 </div>;
}
