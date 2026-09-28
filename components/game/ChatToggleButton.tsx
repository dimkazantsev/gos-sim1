'use client';
import {MessageCircle} from 'lucide-react';

/** Shared top-bar action, also rendered in responsive design tests. */
export default function ChatToggleButton({chatOpen,onToggle}:{chatOpen:boolean;onToggle:()=>void}){
 const title=chatOpen?'Закрыть чат':'Открыть чат';
 return <button
  type="button"
  className={`topChatButton ${chatOpen?'active':''}`}
  onClick={onToggle}
  aria-label={title}
  title={title}
  aria-expanded={chatOpen}
  aria-controls="game-chat"
 >
  <MessageCircle aria-hidden="true" focusable="false"/>
  <span>Чат</span>
 </button>;
}
