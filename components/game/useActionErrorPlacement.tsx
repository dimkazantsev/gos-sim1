'use client';
import {useEffect,useRef,useState,type ChangeEvent,type FormEvent,type MouseEvent} from 'react';
import {createPortal} from 'react-dom';

type ActionTarget={element:HTMLElement;view:string;at:number};
type InlineSlot={element:HTMLElement;message:string};

export function shouldLocalizeActionError(error:string,view:string,action:{view:string;at:number;connected:boolean;file:boolean}|null,now=Date.now()){
 if(!error||!action||action.view!==view||!action.connected||now-action.at>(action.file?90000:30000))return false;
 // Authentication, connection and app initialization errors are not form validation.
 return !/^(Нет доступа к игре|Не удалось открыть игру|Ошибка подключения|Соединение потеряно)/i.test(error);
}


/** Shows action errors beside the control that initiated the request.
 * Background and navigation errors still use the page-level alert. */
export function useActionErrorPlacement(error:string,view:string,clearError:()=>void){
 const lastAction=useRef<ActionTarget|null>(null);
 const [inlineSlot,setInlineSlot]=useState<InlineSlot|null>(null);
 const errorId='gos-action-error';

 function remember(element:HTMLElement|null){
  if(!element||element.closest('.errorBox,.actionErrorNotice,[data-no-inline-error]'))return;
  lastAction.current={element,view,at:Date.now()};
  // Allow an identical backend error to be shown on a subsequent attempt.
  if(error)clearError();
 }

 function onClickCapture(e:MouseEvent<HTMLElement>){
  const origin=e.target;
  if(!(origin instanceof Element))return;
  const control=origin.closest<HTMLElement>('button,[role="button"],input[type="submit"],input[type="button"]');
  if(control&&!control.hasAttribute('disabled')&&control.getAttribute('aria-disabled')!=='true')remember(control);
 }
 function onSubmitCapture(e:FormEvent<HTMLElement>){
  const form=e.target;
  if(!(form instanceof HTMLFormElement))return;
  const source=form.querySelector<HTMLElement>('[type="submit"]')||form;
  remember(source);
 }
 function onChangeCapture(e:ChangeEvent<HTMLElement>){
  const field=e.target;
  if(field instanceof HTMLInputElement&&field.type==='file')remember(field);
 }

 useEffect(()=>{
  if(!error){setInlineSlot(null);return}
  const action=lastAction.current;
  if(!action){setInlineSlot(null);return}
  if(!shouldLocalizeActionError(error,view,{
   view:action.view,at:action.at,connected:action.element.isConnected,
   file:action.element instanceof HTMLInputElement&&action.element.type==='file'
  })){setInlineSlot(null);return}
  const slot=document.createElement('div');
  slot.className='actionErrorSlot';
  const previous=action.element.getAttribute('aria-describedby');
  const describedBy=[previous,errorId].filter(Boolean).join(' ');
  action.element.setAttribute('aria-describedby',describedBy);
  action.element.insertAdjacentElement('afterend',slot);
  setInlineSlot({element:slot,message:error});
  return()=>{
   slot.remove();
   if(action.element.isConnected){
    if(previous===null)action.element.removeAttribute('aria-describedby');
    else action.element.setAttribute('aria-describedby',previous);
   }
  };
 },[error,view]);

 const localized=!!error&&inlineSlot?.message===error&&inlineSlot.element.isConnected;
 const notice=localized?createPortal(
  <div id={errorId} className="actionErrorNotice" role="alert">
   <span>{error}</span>
   <button type="button" className="actionErrorDismiss" aria-label="Закрыть сообщение об ошибке" onClick={clearError}>×</button>
  </div>,inlineSlot.element
 ):null;
 return {onClickCapture,onSubmitCapture,onChangeCapture,localized,notice};
}
