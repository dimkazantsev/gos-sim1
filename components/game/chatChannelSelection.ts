import type {Channel,ChatOverview} from './types';

/** Keep the selector and the displayed chat list consistent. */
export function isHiddenChatChannel(channel:Channel){
 const name=(channel.name||'').trim();
 const lower=name.toLocaleLowerCase('ru-RU');
 if(lower.includes('архив'))return true;
 if(channel.kind==='private'){
  const parts=name.split('·').map(x=>x.trim()).filter(Boolean);
  if(parts.length===2&&parts[0].toLocaleLowerCase('ru-RU')===parts[1].toLocaleLowerCase('ru-RU'))return true;
 }
 return false;
}

export function visibleChatChannels(channels:Channel[],overview:ChatOverview[]){
 const allowed=new Set(overview.map(row=>row.channel_id));
 return channels.filter(channel=>!isHiddenChatChannel(channel)&&(!overview.length||allowed.has(channel.id)));
}

/** Never replace a valid user choice with the latest-message channel. */
export function resolveChatChannelId(channels:Channel[],current:string,saved:string,overview:ChatOverview[]){
 const allowed=new Set(channels.map(channel=>channel.id));
 if(allowed.has(current))return current;
 if(allowed.has(saved))return saved;
 const lastSent=[...overview]
  .filter(row=>row.last_sent_at&&allowed.has(row.channel_id))
  .sort((a,b)=>Date.parse(b.last_sent_at!)-Date.parse(a.last_sent_at!))[0]?.channel_id;
 return lastSent||channels[0]?.id||'';
}
