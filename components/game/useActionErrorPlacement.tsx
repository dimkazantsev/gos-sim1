'use client';
import {useEffect,useRef,useState,type ChangeEvent,type FormEvent,type MouseEvent} from 'react';
import {createPortal} from 'react-dom';

type ActionTarget={element:HTMLElement;view:string;at:number};
type PointerLocation={x:number;y:number;at:number};
type NoticePosition={left:number;top:number};

export function shouldLocalizeActionError(error:string,view:string,action:{view:string;at:number;connected:boolean;file:boolean}|null,now=Date.now()){
 if(!error||!action||action.view!==view||!action.connected||now-action.at>(action.file?90000:30000))return false;
 // Authentication and initial connection errors do not belong to a form control.
 return !/^(Нет доступа к игре|Не удалось открыть игру|Ошибка подключения|Соединение потеряно)/i.test(error);
}

/** Compact viewport overlay for game errors. It never shifts the stage or voting UI.
 * Prefer the latest pointer location; keyboard users receive it near the focused action.
 * The originating control retains aria-describedby when an error belongs to that action.
 */
export function useActionErrorPlacement(error:string,view:string,clearError:()=>void){
 const lastAction=useRef<ActionTarget|null>(null);
 const pointer=useRef<PointerLocation|null>(null);
 const [position,setPosition]=useState<NoticePosition|null>(null);
 const errorId='gos-action-error';

 useEffect(()=>{
  const track=(event:PointerEvent)=>{
   if(event.isPrimary)pointer.current={x:event.clientX,y:event.clientY,at:Date.now()};
  };
  document.addEventListener('pointermove',track,{passive:true});
  document.addEventListener('pointerdown',track,{passive:true});
  return()=>{
   document.removeEventListener('pointermove',track);
   document.removeEventListener('pointerdown',track);
  };
 },[]);

 function remember(element:HTMLElement|null){
  if(!element||element.closest('.errorBox,.actionErrorNotice,[data-no-inline-error]'))return;
  lastAction.current={element,view,at:Date.now()};
  // A second attempt must be able to show the same server error again.
  if(error)clearError();
 }
 function onClickCapture(event:MouseEvent<HTMLElement>){
  if(!(event.target instanceof Element))return;
  const control=event.target.closest<HTMLElement>('button,[role="button"],input[type="submit"],input[type="button"]');
  if(control&&!control.hasAttribute('disabled')&&control.getAttribute('aria-disabled')!=='true')remember(control);
 }
 function onSubmitCapture(event:FormEvent<HTMLElement>){
  if(!(event.target instanceof HTMLFormElement))return;
  remember(event.target.querySelector<HTMLElement>('[type="submit"]')||event.target);
 }
 function onChangeCapture(event:ChangeEvent<HTMLElement>){
  if(event.target instanceof HTMLInputElement&&event.target.type==='file')remember(event.target);
 }

 useEffect(()=>{
  if(!error){setPosition(null);return}
  const action=lastAction.current;
  const linked=!!action&&shouldLocalizeActionError(error,view,{
   view:action.view,at:action.at,connected:action.element.isConnected,
   file:action.element instanceof HTMLInputElement&&action.element.type==='file'
  });
  const focused=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const target=linked?action.element:focused;
  const rect=target?.getBoundingClientRect();
  const recent=pointer.current&&Date.now()-pointer.current.at<120000?pointer.current:null;
  const x=recent?.x??(rect?rect.left+Math.min(rect.width/2,160):window.innerWidth-32);
  const y=recent?.y??(rect?rect.bottom:window.innerHeight-72);
  const noticeWidth=Math.min(340,Math.max(0,window.innerWidth-24));
  setPosition({
   left:Math.max(12,Math.min(x+14,window.innerWidth-noticeWidth-12)),
   top:Math.max(12,Math.min(y+14,Math.max(12,window.innerHeight-190)))
  });
  if(!linked)return;
  const previous=action.element.getAttribute('aria-describedby');
  action.element.setAttribute('aria-describedby',[previous,errorId].filter(Boolean).join(' '));
  return()=>{
   if(action.element.isConnected){
    if(previous===null)action.element.removeAttribute('aria-describedby');
    else action.element.setAttribute('aria-describedby',previous);
   }
  };
 },[error,view]);

 // All mounted-game errors are overlays. No full-width errorBox should flash
 // while the effect locates the cursor or keyboard focus.
 const localized=!!error;
 const notice=error&&typeof document!=='undefined'?createPortal(
  <div id={errorId} className="actionErrorNotice" role="alert"
   style={position?{left:position.left,top:position.top}:{right:12,bottom:12}}>
   <span>{error}</span>
   <button type="button" className="actionErrorDismiss" aria-label="Закрыть сообщение об ошибке" onClick={clearError}>×</button>
  </div>,document.body
 ):null;
 return {onClickCapture,onSubmitCapture,onChangeCapture,localized,notice};
}
