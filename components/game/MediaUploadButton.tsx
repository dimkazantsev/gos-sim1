'use client';
import {useEffect,useMemo,useRef} from 'react';

type Props={
 files:File[];
 onChange:(files:File[])=>void;
 accept?:string;
 multiple?:boolean;
 label?:string;
 hint?:string;
 variant?:'button'|'avatar'|'logo';
};

function MediaIcon(){
 return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h8A2.5 2.5 0 0 1 17 5.5V7h.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-11Zm2.5-.5a.5.5 0 0 0-.5.5v8.7l2.7-2.7a1 1 0 0 1 1.4 0l1.9 1.9 1.7-1.7a1 1 0 0 1 1.4 0l1.9 1.9V5.5a.5.5 0 0 0-.5-.5h-10ZM6 16.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-.1l-3.6-3.6-1.7 1.7a1 1 0 0 1-1.4 0l-1.9-1.9L6 16v.5Zm6.8-7.7a1.3 1.3 0 1 1 2.6 0 1.3 1.3 0 0 1-2.6 0Z"/></svg>;
}

export default function MediaUploadButton({files,onChange,accept='image/*,audio/*,video/*,.pdf,.doc,.docx,.txt',multiple=true,label='Добавить медиа',hint='Фото, видео, аудио или файл',variant='button'}:Props){
 const input=useRef<HTMLInputElement|null>(null);
 const previews=useMemo(()=>files.map(f=>({file:f,url:(f.type.startsWith('image/')||f.type.startsWith('video/')||f.type.startsWith('audio/'))?URL.createObjectURL(f):''})),[files]);
 useEffect(()=>()=>{for(const p of previews)if(p.url)URL.revokeObjectURL(p.url)},[previews]);
 function pick(next:FileList|null){
  const arr=Array.from(next||[]);
  if(!arr.length)return;
  onChange(multiple?[...files,...arr].slice(0,12):[arr[0]]);
  if(input.current)input.current.value='';
 }
 function remove(i:number){onChange(files.filter((_,idx)=>idx!==i))}
 return <div className={'mediaPicker '+variant}>
  <button type="button" className="mediaPickerButton" onClick={()=>input.current?.click()} aria-label={label}>
   <MediaIcon/><span><b>{label}</b><small>{hint}</small></span>
  </button>
  <input ref={input} hidden type="file" accept={accept} multiple={multiple} onChange={e=>pick(e.target.files)}/>
  {files.length>0&&<div className="mediaPickerPreview">
   {previews.map((p,i)=><div className="mediaPreviewItem" key={p.file.name+'-'+p.file.size+'-'+i}>
    {p.file.type.startsWith('image/')?<img src={p.url} alt="Предпросмотр"/>:
     p.file.type.startsWith('video/')?<video src={p.url} muted/>:
     p.file.type.startsWith('audio/')?<div className="mediaTypeIcon">♫</div>:
     <div className="mediaTypeIcon">▤</div>}
    <span>{p.file.name}</span>
    <button type="button" onClick={()=>remove(i)} aria-label="Удалить файл">×</button>
   </div>)}
  </div>}
 </div>;
}