import type {runtimeConfig} from './telegram';
import {isHiddenChatChannel} from '@/components/game/chatChannelSelection';

type Db=ReturnType<typeof runtimeConfig>['db'];
type VisibleChannel={id:string;game_id:string;name:string;kind:string};

/** Match the active game's chat selector, including hidden archive names and
 * incomplete private conversations. The bot's service role bypasses RLS, so
 * it must apply equivalent membership restrictions explicitly. */
export async function telegramVisibleChatChannels(db:Db,gameId:string,userId:string):Promise<VisibleChannel[]>{
 const [person,rooms]=await Promise.all([
  db.from('game_members').select('kind').eq('game_id',gameId).eq('user_id',userId)
   .is('roster_archived_at',null).maybeSingle(),
  db.from('chat_channels').select('id,game_id,name,kind').eq('game_id',gameId)
 ]);
 if(person.error)throw person.error;
 if(rooms.error)throw rooms.error;
 if(!person.data)return [];
 const channels=rooms.data||[];
 if(!channels.length)return [];
 const {data:memberships,error}=await db.from('channel_members').select('channel_id,user_id')
  .in('channel_id',channels.map(c=>c.id));
 if(error)throw error;
 const counts=new Map<string,number>();
 const mine=new Set<string>();
 for(const membership of memberships||[]){
  counts.set(membership.channel_id,(counts.get(membership.channel_id)||0)+1);
  if(membership.user_id===userId)mine.add(membership.channel_id);
 }
 return channels.filter(c=>
  !isHiddenChatChannel(c)&&
  (c.kind!=='private'||counts.get(c.id)===2)&&
  (c.kind==='public'||person.data.kind==='teacher'||mine.has(c.id))
 );
}
