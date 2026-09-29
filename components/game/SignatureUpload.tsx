'use client';
import {useEffect,useRef,useState} from 'react';
import {Check,ImageUp,Scissors,ShieldCheck} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';

export default function SignatureUpload({g}:{g:ReturnTypeRepublic}){
 const input=useRef<HTMLInputElement>(null);
 const [file,setFile]=useState<File|null>(null);
 const [url,setUrl]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const mine=g.profiles.find(p=>p.user_id===g.me?.user_id);
 useEffect(()=>{if(!file){setUrl('');return}const current=URL.createObjectURL(file);setUrl(current);return()=>URL.revokeObjectURL(current)},[file]);
 async function crop(raw:File){
  if(raw.size>5*1024*1024){setNotice('Загрузите изображение размером до 5 МБ.');return}
  if(!['image/png','image/jpeg','image/webp'].includes(raw.type)){setNotice('Допустимые форматы: PNG, JPEG и WebP.');return}
  setBusy(true);setNotice('');
  try{
   const bitmap=await createImageBitmap(raw);
   const factor=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
   const w=Math.max(1,Math.round(bitmap.width*factor)),h=Math.max(1,Math.round(bitmap.height*factor));
   const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Обработка изображения недоступна');
   ctx.drawImage(bitmap,0,0,w,h);bitmap.close();
   const image=ctx.getImageData(0,0,w,h),px=image.data;
   let left=w,top=h,right=0,bottom=0,found=false;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=(y*w+x)*4,r=px[k],gg=px[k+1],b=px[k+2];
    const dark=Math.min(r,gg,b)<192,blue= b>r*1.12&&b>gg*1.04&&r<205;
    const keep=(dark||blue)&&px[k+3]>50;
    if(!keep){px[k+3]=0;continue}
    found=true;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
   }
   if(!found)throw new Error('Не удалось выделить подпись. Попробуйте сфотографировать тёмную подпись на белом листе при хорошем освещении.');
   ctx.putImageData(image,0,0);
   const pad=Math.max(12,Math.round(w*.018));
   const sx=Math.max(0,left-pad),sy=Math.max(0,top-pad);
   const sw=Math.min(w-sx,right+pad+1-sx),sh=Math.min(h-sy,bottom+pad+1-sy);
   const output=document.createElement('canvas');const ratio=Math.min(1,900/sw,300/sh);
   output.width=Math.max(1,Math.round(sw*ratio));output.height=Math.max(1,Math.round(sh*ratio));
   const out=output.getContext('2d');if(!out)throw new Error('Не удалось подготовить PNG');
   out.clearRect(0,0,output.width,output.height);
   out.drawImage(canvas,sx,sy,sw,sh,0,0,output.width,output.height);
   const blob=await new Promise<Blob|null>(res=>output.toBlob(res,'image/png'));
   if(!blob)throw new Error('Не удалось создать изображение PNG');
   setFile(new File([blob],'signature.png',{type:'image/png'}));
   setNotice('Фон удалён и подпись обрезана. Проверьте предпросмотр, затем сохраните.');
  }catch(e){setNotice(e instanceof Error?e.message:'Не удалось обработать изображение.')}finally{setBusy(false)}
 }
 async function save(){
  if(!file||busy)return;
  setBusy(true);setNotice('');
  const ok=await g.saveSignature(file);
  setBusy(false);
  if(ok){setFile(null);setNotice('Подпись сохранена. При подписании последующих НПА будет записан неизменяемый снимок изображения.')}
  else setNotice('Подпись не сохранена. Проверьте уведомление в игре.');
 }
 return <section className="profileSignature" aria-label="Игровая подпись">
  <header><div><small>ДОКУМЕНТЫ И РЕЕСТР НПА</small><h2>Игровая подпись</h2></div><Scissors size={21} aria-hidden="true"/></header>
  <p>Расписывайтесь тёмной ручкой на чистом белом листе. Сделайте фото при ровном освещении либо загрузите PNG. Система удалит светлый фон, обрежет пустое поле и предложит проверить результат. Это визуальная подпись для учебной игры, а не юридически значимая электронная подпись.</p>
  <div className="profileSignaturePreview">
   {url?<img src={url} alt="Подпись после автоматического удаления фона"/>:mine?.signature_url?<img src={mine.signature_url} alt="Сохранённая игровая подпись"/>:<span>Подпись ещё не загружена</span>}
  </div>
  <input type="file" accept="image/png,image/jpeg,image/webp" ref={input} hidden aria-label="Выбрать фото подписи"
   onChange={e=>{const chosen=e.target.files?.[0];if(chosen)void crop(chosen);e.target.value=''}}/>
  <div className="profileSignatureActions">
   <button type="button" disabled={busy} onClick={()=>input.current?.click()}><ImageUp size={17}/> Загрузить и обрезать</button>
   <button type="button" className="primary" disabled={busy||!file} onClick={()=>void save()}><Check size={17}/> {busy?'Обработка…':'Сохранить подпись'}</button>
  </div>
  {notice&&<p role="status" className="profileSignatureNotice">{notice}</p>}
  <p className="profileSignatureFine"><ShieldCheck size={15}/> Ранее подписанные НПА сохраняют изображение, которое действовало в момент подписания.</p>
 </section>;
}
