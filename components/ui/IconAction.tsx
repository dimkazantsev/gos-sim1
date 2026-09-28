'use client';
import {X} from 'lucide-react';
import type {MouseEventHandler} from 'react';

/** Shared icon-only action for all modal and inline dismiss controls.
 * A fixed optical centre keeps the cross consistent across browsers and fonts.
 * Labels are required, so close and destructive remove actions stay distinct.
 */
type IconActionProps={
 onClick:MouseEventHandler<HTMLButtonElement>;
 label:string;
 className?:string;
 title?:string;
 disabled?:boolean;
 variant?:'close'|'remove';
};

export function IconAction({onClick,label,className='',title,disabled=false,variant='close'}:IconActionProps){
 return <button
  type="button"
  onClick={onClick}
  className={['gsIconAction',variant==='remove'?'gsIconAction--remove':'gsIconAction--close',className].filter(Boolean).join(' ')}
  aria-label={label}
  title={title||label}
  disabled={disabled}
 >
  <X aria-hidden="true" focusable="false" strokeWidth={2} size={20}/>
 </button>;
}
