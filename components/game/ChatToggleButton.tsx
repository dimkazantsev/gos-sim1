'use client';
import {MessageCircle} from 'lucide-react';
import {CHAT_PAUSED} from '@/lib/featureFreeze';

/** Shared top-bar action, also rendered in responsive design tests. */
export default function ChatToggleButton({chatOpen,onToggle,onExpand,unreadCount=0,mentionCount=0}:{chatOpen:boolean;onToggle:()=>void;onExpand?:()=>void;unreadCount?:number;mentionCount?:number}){
 const title=CHAT_PAUSED?'Чат временно приостановлен':chatOpen?'Закрыть чат':'Открыть чат';
 return <button
  type="button"
  className={`topChatButton ${chatOpen?'active':''}`}
  onClick={event=>{
   // A double click also emits two click events. Ignore the second so the
   // compact chat is not closed immediately before the expand command.
   if(onExpand&&event.button===0&&event.detail===2)return;
   onToggle();
  }}
  onDoubleClick={event=>{if(event.button===0)onExpand?.()}}
  disabled={CHAT_PAUSED}
  aria-label={title}
  title={title}
  aria-expanded={chatOpen}
  aria-controls="game-chat"
 >
  <i className="topChatIconWrap"><MessageCircle aria-hidden="true" focusable="false"/>{!CHAT_PAUSED&&unreadCount>0&&<i className={'topChatUnread '+(mentionCount>0?'hasMention':'')} aria-label={(mentionCount>0?'Упоминаний: '+mentionCount+'. ':'')+'Непрочитанных сообщений: '+unreadCount}>{unreadCount>99?'99+':unreadCount}</i>}</i>
  <span>Чат</span>
 </button>;
}
