import type {Message} from './types';

// Apply authorised Postgres Changes immediately. Merge by id so sender RPC
// responses, Realtime events and recovery polls never show duplicate messages.
export function mergeChatMessages(previous:readonly Message[],incoming:readonly Message[],limit=150):Message[]{
 const byId=new Map<string,Message>();
 for(const message of previous)byId.set(message.id,message);
 for(const message of incoming){
  const old=byId.get(message.id);
  byId.set(message.id,{...old,...message,url:message.url??old?.url??null});
 }
 return [...byId.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)).slice(-limit);
}
