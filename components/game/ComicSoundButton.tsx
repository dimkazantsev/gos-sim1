'use client';
import {useEffect,useId,useState} from 'react';
import {Volume2,VolumeX} from 'lucide-react';
let context:AudioContext|undefined;
let source:AudioBufferSourceNode|undefined;
let active='';
const listeners=new Set<(id:string)=>void>();
function notify(){listeners.forEach(fn=>fn(active))}
function stop(id?:string){
 if(id&&active!==id)return;
 try{source?.stop()}catch{}
 source?.disconnect();source=undefined;active='';notify();
}
function score(ctx:AudioContext){
 const duration=36,length=Math.round(ctx.sampleRate*duration),buffer=ctx.createBuffer(2,length,ctx.sampleRate);
 const chords=[[130.81,164.81,196],[146.83,174.61,220],[164.81,196,246.94],[130.81,174.61,220],[130.81,164.81,196],[146.83,174.61,220],[164.81,196,246.94],[123.47,146.83,196],[130.81,164.81,196]];
 for(let channel=0;channel<2;channel++){
  const samples=buffer.getChannelData(channel);
  for(let i=0;i<length;i++){
   const t=i/ctx.sampleRate,bar=Math.floor(t/4),local=t%4,fade=Math.min(1,t/1.5,(duration-t)/1.5);
   const blend=Math.min(1,local/.65),smooth=blend*blend*(3-2*blend);
   let tone=0;
   for(let j=0;j<3;j++){
    const current=Math.round(chords[bar][j]*duration)/duration,previous=Math.round(chords[(bar+8)%9][j]*duration)/duration;
    const phase=j*.63+channel*.14;
    tone+=(Math.sin(2*Math.PI*current*t+phase)*smooth+Math.sin(2*Math.PI*previous*t+phase)*(1-smooth))*.045;
   }
   const pulse=Math.pow(Math.max(0,Math.sin(Math.PI*(t%2)/2)),8)*.035*Math.sin(2*Math.PI*48*t);
   samples[i]=(tone+pulse)*Math.max(0,fade)*.7;
  }
 }
 return buffer;
}
async function start(id:string){
 stop();context??=new AudioContext();await context.resume();
 source=context.createBufferSource();source.buffer=score(context);source.loop=true;source.loopStart=0;source.loopEnd=36;
 source.connect(context.destination);source.start();active=id;notify();
}
export default function ComicSoundButton({playing=true,iconOnly=false}:{playing?:boolean;iconOnly?:boolean}){
 const id=useId(),[enabled,setEnabled]=useState(false),[failure,setFailure]=useState('');
 useEffect(()=>{const update=(owner:string)=>setEnabled(owner===id);listeners.add(update);return()=>{listeners.delete(update);stop(id)}},[id]);
 useEffect(()=>{if(!playing)stop(id)},[playing,id]);
 async function toggle(){
  setFailure('');if(enabled){stop(id);return}
  try{await start(id)}catch{setFailure('Не удалось включить звук. Нажмите ещё раз.')}
 }
 return <button type="button" className={'comicSoundButton '+(iconOnly?'iconOnly':'')} aria-pressed={enabled} aria-label={enabled?'Выключить звук комикса':'Включить звук комикса'} title={failure||'Музыка · Плавный цикл 36 секунд'} onClick={()=>void toggle()}>{enabled?<Volume2 size={18}/>:<VolumeX size={18}/>} {!iconOnly&&<span>{enabled?'Звук включён':'Включить звук'}</span>}</button>;
}
