'use client';
import {useEffect,useId,useState} from 'react';
import {LoaderCircle,Volume2,VolumeX} from 'lucide-react';
let context:AudioContext|undefined;
let source:AudioBufferSourceNode|undefined;
let scorePromise:Promise<AudioBuffer>|undefined;
let active='',pending='',generation=0;
const listeners=new Set<(owner:string,loading:string)=>void>();
function notify(){listeners.forEach(fn=>fn(active,pending))}
function stop(id?:string){
 if(id&&active!==id&&pending!==id)return;
 generation++;pending='';
 try{source?.stop()}catch{}
 source?.disconnect();source=undefined;active='';notify();
}
/** Native offline rendering keeps preparation off the UI thread; reuse the finished score. */
async function score(ctx:AudioContext){
 const duration=36,offline=new OfflineAudioContext(2,Math.round(ctx.sampleRate*duration),ctx.sampleRate);
 const master=offline.createGain();master.gain.value=.22;master.connect(offline.destination);
 const chords=[[130.81,164.81,196],[146.83,174.61,220],[164.81,196,246.94],[130.81,174.61,220],[130.81,164.81,196],[146.83,174.61,220],[164.81,196,246.94],[123.47,146.83,196],[130.81,164.81,196]];
 chords.forEach((chord,bar)=>chord.forEach(frequency=>{
  const oscillator=offline.createOscillator(),gain=offline.createGain(),start=bar*4,end=Math.min(duration,start+4.5);
  oscillator.frequency.value=frequency;oscillator.type='sine';
  gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.12,start+.6);
  gain.gain.setValueAtTime(.12,Math.max(start+.6,end-.7));gain.gain.linearRampToValueAtTime(0,end);
  oscillator.connect(gain);gain.connect(master);oscillator.start(start);oscillator.stop(end);
 }));
 return offline.startRendering();
}
async function start(id:string){
 stop();const ticket=generation;pending=id;notify();
 try{
  context??=new AudioContext();await context.resume();
  scorePromise??=score(context);const buffer=await scorePromise;
  // Closing the dialog or pressing mute cancels a pending start, too.
  if(ticket!==generation||pending!==id)return;
  const next=context.createBufferSource();next.buffer=buffer;next.loop=true;next.loopEnd=36;
  next.connect(context.destination);next.start();source=next;active=id;pending='';notify();
 }catch(error){if(ticket===generation){pending='';scorePromise=undefined;notify();throw error;}}
}
export default function ComicSoundButton({playing=true,iconOnly=false}:{playing?:boolean;iconOnly?:boolean}){
 const id=useId(),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[failure,setFailure]=useState('');
 useEffect(()=>{const update=(owner:string,loading:string)=>{setEnabled(owner===id);setBusy(loading===id)};listeners.add(update);return()=>{listeners.delete(update);stop(id)}},[id]);
 useEffect(()=>{if(!playing)stop(id)},[playing,id]);
 async function toggle(){
  setFailure('');if(enabled||busy){stop(id);return}
  try{await start(id)}catch{setFailure('Не удалось включить звук. Нажмите ещё раз.')}
 }
 const label=busy?'Отменить включение звука':enabled?'Выключить звук комикса':'Включить звук комикса';
 return <button type="button" className={'comicSoundButton '+(iconOnly?'iconOnly':'')} aria-pressed={enabled} aria-busy={busy} aria-label={label} title={failure||label} onClick={()=>void toggle()}>{busy?<LoaderCircle size={18}/>:enabled?<Volume2 size={18}/>:<VolumeX size={18}/>} {!iconOnly&&<span>{busy?'Подготовка звука…':enabled?'Звук включён':'Включить звук'}</span>}</button>;
}
