'use client';
import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {preparePartyLogo,type PartyLogoPlacement} from './partyLogoCrop';

type Props={onSave:(file:File)=>Promise<boolean>;disabled?:boolean;partyName:string};
const defaultPlacement:PartyLogoPlacement={zoom:1,x:0,y:0};
const clamp=(n:number)=>Math.max(-100,Math.min(100,n));

export default function PartyLogoEditor({onSave,disabled=false,partyName}:Props){
 const [file,setFile]=useState<File|null>(null);
 const [preview,setPreview]=useState('');
 const [dimensions,setDimensions]=useState({width:0,height:0});
 const [placement,setPlacement]=useState<PartyLogoPlacement>(defaultPlacement);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [saving,setSaving]=useState(false);
 const drag=useRef<{pointerId:number;x:number;y:number;offsetX:number;offsetY:number}|null>(null);
 useEffect(()=>{
  if(!file){setPreview('');return}
  const url=URL.createObjectURL(file);
  setPreview(url);
  return()=>URL.revokeObjectURL(url);
 },[file]);
 function choose(next:File|null){
  setError('');setNotice('');setDimensions({width:0,height:0});setPlacement(defaultPlacement);
  if(!next){setFile(null);return}
  if(!['image/png','image/jpeg','image/webp'].includes(next.type)||next.size===0||next.size>8*1024*1024){
   setFile(null);setError('Допускаются PNG, JPEG и WebP размером до 8 МБ.');return;
  }
  setFile(next);
 }
 function dragStart(event:ReactPointerEvent<HTMLDivElement>){
  if(!file||saving||!dimensions.width)return;
  drag.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,offsetX:placement.x,offsetY:placement.y};
  event.currentTarget.setPointerCapture(event.pointerId);
 }
 function dragMove(event:ReactPointerEvent<HTMLDivElement>){
  const start=drag.current;if(!start||start.pointerId!==event.pointerId)return;
  const width=event.currentTarget.getBoundingClientRect().width;
  if(width<=0)return;
  setPlacement(old=>({...old,x:clamp(start.offsetX+(event.clientX-start.x)*100/width),
   y:clamp(start.offsetY+(event.clientY-start.y)*100/width)}));
 }
 function dragEnd(event:ReactPointerEvent<HTMLDivElement>){
  if(drag.current?.pointerId===event.pointerId)drag.current=null;
 }
 async function save(){
  if(!file||disabled||saving)return;
  setSaving(true);setError('');setNotice('');
  try{
   const processed=await preparePartyLogo(file,placement);
   const ok=await onSave(processed);
   if(ok){setFile(null);setNotice('Эмблема сохранена и будет показана в карточке партии.')}
   else setError('Не удалось загрузить эмблему. Проверьте сообщение об ошибке и повторите попытку.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось обработать изображение.');}
  finally{setSaving(false)}
 }
 const isBusy=disabled||saving;
 return <div className="partyLogoEditor">
  <label className="partyLogoFileLabel">Загрузить эмблему партии
   <input aria-label={'Выбрать эмблему: '+partyName} type="file" accept="image/png,image/jpeg,image/webp" disabled={isBusy}
    onChange={e=>{choose(e.target.files?.[0]||null);e.target.value=''}}/>
  </label>
  <p className="partyLogoEditorHelp">PNG, JPEG или WebP до 8 МБ. Настройте масштаб и положение перед сохранением. Изображение будет преобразовано в квадрат 640 × 640 пикселей.</p>
  {file&&preview&&<div className="partyLogoEditorWorkspace">
   <div className="partyLogoCropViewport" role="img" aria-label={'Предпросмотр эмблемы '+partyName+'. Перетащите для перемещения.'}
    onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
    <img src={preview} alt="" draggable={false} onLoad={e=>setDimensions({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}
     style={{transform:`translate(${placement.x}%,${placement.y}%) scale(${placement.zoom})`}}/>
   </div>
   <div className="partyLogoCropControls">
    <label>Масштаб — {Math.round(placement.zoom*100)}%
     <input type="range" min="1" max="6" step=".05" value={placement.zoom} disabled={isBusy}
      onChange={e=>setPlacement(old=>({...old,zoom:Number(e.target.value)}))}/>
    </label>
    <label>По горизонтали
     <input type="range" min="-100" max="100" step="1" value={placement.x} disabled={isBusy}
      onChange={e=>setPlacement(old=>({...old,x:Number(e.target.value)}))}/>
    </label>
    <label>По вертикали
     <input type="range" min="-100" max="100" step="1" value={placement.y} disabled={isBusy}
      onChange={e=>setPlacement(old=>({...old,y:Number(e.target.value)}))}/>
    </label>
    <div className="partyLogoCropPresets">
     <button type="button" className="secondary" disabled={isBusy} onClick={()=>setPlacement(defaultPlacement)}>Поместить полностью</button>
     <button type="button" className="secondary" disabled={isBusy||!dimensions.width} onClick={()=>{
      const cover=Math.max(dimensions.width/dimensions.height,dimensions.height/dimensions.width);
      setPlacement({zoom:Math.min(6,Math.max(1,Math.ceil(cover*20)/20)),x:0,y:0});
     }}>Заполнить квадрат</button>
    </div>
    <button type="button" className="primary" disabled={isBusy||!dimensions.width} onClick={()=>void save()}>
     {saving?'Сохранение…':'Сохранить эмблему'}
    </button>
   </div>
  </div>}
  {error&&<p className="partyLogoCropError" role="alert">{error}</p>}
  {notice&&<p className="partyLogoCropNotice" role="status">{notice}</p>}
 </div>;
}
