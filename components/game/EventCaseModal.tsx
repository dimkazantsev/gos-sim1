'use client';
import type {ReactNode} from 'react';
import ComicSoundButton from './ComicSoundButton';
import {X} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
export default function EventCaseModal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const ref=useDialog(true,onClose);
 return <div className="eventCaseBackdrop" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section className="eventCaseModal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="eventCaseModalTitle" tabIndex={-1}>
   <header className="eventModalHeader"><div><small>Игровая ситуация</small><h3 id="eventCaseModalTitle">{title}</h3></div><div className="eventModalActions"><ComicSoundButton iconOnly/><button type="button" className="eventModalClose" aria-label="Закрыть событие" onClick={onClose}><X size={22}/></button></div></header>
   <div className="eventModalBody">{children}</div>
  </section>
 </div>;
}
