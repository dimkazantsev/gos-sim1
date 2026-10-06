'use client';
import {MessageCircle} from 'lucide-react';

/** Shared top-bar action, also rendered in responsive design tests. */
export default function ChatToggleButton({chatOpen,onToggle,unreadCount=0,mentionCount=0}:{chatOpen:boolean;onToggle:()=>void;unreadCount?:number;mentionCount?:number}){
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
  <span className="topChatIconWrap"><MessageCircle aria-hidden="true" focusable="false"/>{unreadCount>0&&<i className={'topChatUnread '+(mentionCount>0?'hasMention':'')} aria-label={(mentionCount>0?'Упоминаний: '+mentionCount+'. ':'')+'Непрочитанных сообщений: '+unreadCount}>{unreadCount>99?'99+':unreadCount}</i>}</span>
  <span>Чат</span>
 </button>;
}
