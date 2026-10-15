'use client';

import {useEffect,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {IconAction} from '../ui/IconAction';

/** A short-lived origin for an error caused by an explicit action, never a background refresh. */
export type GameErrorAction={
 element:HTMLElement;
 view:string;
 at:number;
};

const ACTION_ERROR_WINDOW_MS=12000;

export function findGameErrorAction(target:EventTarget|null,root:HTMLElement):HTMLElement|null{
 if(!(target instanceof Element))return null;
 const action=target.closest<HTMLElement>('button, input[type="submit"], [role="button"]');
 if(!action||!root.contains(action)||action.matches(':disabled,[aria-disabled="true"]'))return null;
 if(action.closest('[data-game-error-surface]'))return null;
 return action;
}

/** Messages from background reads and authentication continue to use the normal top banner.
 * Action errors are rendered in the form flow immediately following the triggering control. */
export default function ContextualGameError({
 error,onClose,origin,view
}:{
 error:string;
 onClose:()=>void;
 origin:RefObject<GameErrorAction|null>;
 view:string;
}){
 const [slot,setSlot]=useState<HTMLElement|null>(null);
 const [actionLabel,setActionLabel]=useState('');

 useEffect(()=>{
  setSlot(null);
  if(!error)return;
  const action=origin.current;
  if(!action||action.view!==view||Date.now()-action.at>ACTION_ERROR_WINDOW_MS)return;
  const element=action.element;
  if(!element.isConnected||!element.getClientRects().length)return;
  const container=element.ownerDocument.createElement('div');
  container.className='gameActionErrorSlot';
  container.setAttribute('data-game-error-surface','');
  const label=(element.getAttribute('aria-label')||element.textContent||'').trim().replace(/\s+/g,' ').slice(0,90);
  setActionLabel(label);
  // A notice must not become another item in a non-wrapping flex toolbar.
  // Put it directly below that toolbar instead of squeezing its controls.
  const parent=element.parentElement;
  const layout=parent?element.ownerDocument.defaultView?.getComputedStyle(parent):null;
  const rowFlex=!!layout&&layout.display.includes('flex')&&layout.flexDirection.startsWith('row')&&layout.flexWrap==='nowrap';
  (rowFlex&&parent?parent:element).insertAdjacentElement('afterend',container);
  setSlot(container);
  return()=>container.remove();
 },[error,view,origin]);

 if(!error)return null;
 const notice=<div className={slot?'gameActionError':'errorBox closable'} data-game-error-surface role="alert">
  <div className="gameActionErrorCopy">
   {slot&&actionLabel&&<strong>Действие: {actionLabel}</strong>}
   <span>{error}</span>
  </div>
  <IconAction onClick={onClose} label="Закрыть сообщение об ошибке"/>
 </div>;
 return slot?createPortal(notice,slot):notice;
}
