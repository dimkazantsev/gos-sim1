import type {runtimeConfig} from './telegram';
import type {TelegramMarkup} from './telegramPresentation';
import {resolveAppealRecipient,appealRecipientError,telegramSentence} from './telegramRepublicText';

type Db=ReturnType<typeof runtimeConfig>['db'];
type Reply=(text:string,buttons?:TelegramMarkup)=>Promise<void>;
type Person={user_id:string;full_name:string|null;kind:string};
type Params={
 db:Db;gameId:string;userId:string;telegramId:number;messageId:number;
 text:string;isCallback:boolean;reply:Reply;
};
const ACTIVE=['awaiting_text','preview'];
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const name=(p:Pick<Person,'full_name'>)=>p.full_name?.trim()||'Участник';
const options=(name:string,id:string)=>({text:name.slice(0,56),callback_data:'gos:appeal:pick:'+id});
const back:TelegramMarkup={inline_keyboard:[[{text:'🏛 Меню',callback_data:'gos:menu'}]]};

function previewButtons(id:string):TelegramMarkup{
 return {inline_keyboard:[
  [{text:'✅ Отправить обращение',callback_data:'gos:appeal:confirm:'+id}],
  [{text:'✏️ Изменить текст',callback_data:'gos:appeal:edit:'+id},
   {text:'✖️ Отменить',callback_data:'gos:appeal:cancel:'+id}],
  [{text:'🏛 Меню',callback_data:'gos:menu'}]
 ]};
}
async function getRoster(db:Db,gameId:string):Promise<Person[]>{
 const {data,error}=await db.from('game_members').select('user_id,full_name,kind')
  .eq('game_id',gameId).is('roster_archived_at',null)
  .neq('kind','observer').order('full_name').limit(150);
 if(error)throw error;
 return data||[];
}
async function replaceDraft(db:Db,gameId:string,userId:string,recipientId:string,
 body?:string,messageId?:number){
 // Pending drafts are private and short lived; sent appeals are never modified.
 const {error:cancelError}=await db.from('telegram_appeal_drafts')
  .update({status:'cancelled'}).eq('game_id',gameId).eq('author_id',userId)
  .in('status',ACTIVE);
 if(cancelError)throw cancelError;
 const {data,error}=await db.from('telegram_appeal_drafts').insert({
  game_id:gameId,author_id:userId,recipient_id:recipientId,
  status:body?'preview':'awaiting_text',
  body:body||null,source_message_id:messageId||null
 }).select('id').single();
 if(error)throw error;
 return data.id;
}
async function renderPreview(db:Db,gameId:string,userId:string,id:string,recipientId:string,body:string,reply:Reply){
 const {data:recipient,error}=await db.from('game_members')
  .select('full_name').eq('game_id',gameId).eq('user_id',recipientId)
  .is('roster_archived_at',null).maybeSingle();
 if(error)throw error;
 await reply('📨 ГОС.ID · Предпросмотр обращения\n\nАдресат: '+(recipient?.full_name||'Недоступен')+
  '\n\nТекст обращения:\n'+body+'\n\nОбращение ещё не отправлено. Подтвердите отправку или измените текст.',
  previewButtons(id));
}
export async function handleTelegramAppeal({db,gameId,userId,telegramId,messageId,text,isCallback,reply}:Params):Promise<boolean>{
 const args=text.split(/\s+/),command=args[0];
 const roster=()=>getRoster(db,gameId);
 if(command==='/appeal'||command==='/appeal_page'){
  const match=text.match(/^\/appeal\s+@([\p{L}\p{N}_-]+)\s+([\s\S]+)$/u);
  if(match){
   const body=match[2].trim();
   if(body.length<10||body.length>4000){
    await reply('⚠️ ГОС.ID · Приёмная\n\nТекст обращения должен содержать от 10 до 4000 символов.');
    return true;
   }
   const people=await roster(),result=resolveAppealRecipient(people,userId,match[1]);
   if(result.kind!=='found'){await reply(appealRecipientError(result));return true}
   const id=await replaceDraft(db,gameId,userId,result.recipient.user_id,body,messageId);
   await renderPreview(db,gameId,userId,id,result.recipient.user_id,body,reply);
   return true;
  }
  const people=(await roster()).filter(x=>x.user_id!==userId);
  const page=command==='/appeal_page'?Math.max(0,Math.min(99,Number(args[1])||0)):0;
  const totalPages=Math.max(1,Math.ceil(people.length/8));
  const current=Math.min(page,totalPages-1);
  const shown=people.slice(current*8,(current+1)*8);
  const {data:actor}=await db.from('game_members').select('kind')
   .eq('game_id',gameId).eq('user_id',userId).is('roster_archived_at',null).maybeSingle();
  const buttons:TelegramMarkup={inline_keyboard:[
   ...shown.map(p=>[options(name(p),p.user_id)]),
   ...(totalPages>1?[[
    ...(current>0?[{text:'← Назад',callback_data:'gos:appeal:page:'+(current-1)}]:[]),
    ...(current<totalPages-1?[{text:'Далее →',callback_data:'gos:appeal:page:'+(current+1)}]:[])
   ]]:[]),
   ...(actor?.kind==='teacher'?[[{text:'🧪 Проверка приёмной',callback_data:'gos:appeal:test'}]]:[]),
   [{text:'🏛 Меню',callback_data:'gos:menu'}]
  ]};
  await reply('🏛 ГОС.ID · Приёмная\n\n'+(people.length
   ?'Выберите адресата из действующих участников. После выбора отправьте текст обращения отдельным сообщением. Перед отправкой появится подтверждение.'
   :'Сейчас нет других действующих участников, которым можно направить обращение.')+
   (totalPages>1?'\n\nСтраница '+(current+1)+' из '+totalPages+'.':''),buttons);
  return true;
 }
 if(command==='/appeal_test'){
  const {data:actor,error}=await db.from('game_members').select('kind')
   .eq('game_id',gameId).eq('user_id',userId)
   .is('roster_archived_at',null).maybeSingle();
  if(error)throw error;
  if(actor?.kind!=='teacher'){await reply('⛔ ГОС.ID · Приёмная\n\nПроверка доступна только преподавателю.');return true}
  const others=(await roster()).filter(p=>p.user_id!==userId);
  const sample=others[0];
  const check=sample?resolveAppealRecipient([sample],userId,name(sample).split(/\s+/)[0]):null;
  await reply('🧪 ГОС.ID · Проверка приёмной\n\nДоступ преподавателя: подтверждён.\n'+
   'Действующих адресатов: '+others.length+'.\n'+
   'Проверка выбора адресата: '+(check?.kind==='found'?'успешна.':'нет доступных адресатов.')+
   '\nПроверка запрета обращения самому себе: включена.\n'+
   'Созданных обращений: 0.\n\nЭто симуляция: записи, уведомления и игровые данные не изменялись.',
   {inline_keyboard:[[{text:'↩ К адресатам',callback_data:'gos:appeal'}],...back.inline_keyboard]});
  return true;
 }
 const special=text.match(/^\/appeal_(pick|confirm|edit|cancel)\s+([0-9a-f-]{36})$/i);
 if(special&&uuid.test(special[2])){
  const action=special[1],id=special[2];
  if(action==='pick'){
   const people=await roster(),person=people.find(p=>p.user_id===id&&p.user_id!==userId);
   if(!person){await reply('⚠️ ГОС.ID · Приёмная\n\nАдресат больше недоступен. Обновите список через /appeal.');return true}
   await replaceDraft(db,gameId,userId,id);
   await reply('✍️ ГОС.ID · Новое обращение\n\nАдресат: '+name(person)+
    '\n\nОтправьте текст обращения обычным сообщением длиной от 10 до 4000 символов. Перед отправкой вы сможете проверить и изменить текст.');
   return true;
  }
  const {data:draft,error}=await db.from('telegram_appeal_drafts')
   .select('id,recipient_id,body,status,expires_at,appeal_id')
   .eq('id',id).eq('game_id',gameId).eq('author_id',userId).maybeSingle();
  if(error)throw error;
  if(!draft||new Date(draft.expires_at).getTime()<Date.now()&&draft.status!=='sent'){
   await reply('⚠️ ГОС.ID · Приёмная\n\nЧерновик не найден или срок его действия истёк. Начните заново через /appeal.');
   return true;
  }
  if(action==='confirm'){
   if(draft.status!=='preview'&&draft.status!=='sent'){
    await reply('⚠️ ГОС.ID · Приёмная\n\nПеред отправкой необходимо подготовить и проверить текст.');
    return true;
   }
   const {data:result,error:confirmError}=await db.rpc('telegram_confirm_appeal_draft',{
    p_telegram_user_id:telegramId,p_draft_id:id
   });
   if(confirmError)throw confirmError;
   await reply('✅ ГОС.ID · Приёмная\n\nОбращение отправлено адресату.\nКод обращения: '+
    String(result).replace(/-/g,'').slice(0,12).toUpperCase()+'.');
   return true;
  }
  if(draft.status==='sent'){await reply('ℹ️ ГОС.ID · Приёмная\n\nОбращение уже отправлено.');return true}
  const {error:editError}=await db.from('telegram_appeal_drafts').update(
   action==='cancel'?{status:'cancelled'}:{status:'awaiting_text',body:null,source_message_id:null}
  ).eq('id',id).eq('game_id',gameId).eq('author_id',userId)
   .in('status',ACTIVE);
  if(editError)throw editError;
  await reply(action==='cancel'
   ?'🏛 ГОС.ID · Приёмная\n\nЧерновик отменён. Новое обращение можно начать через /appeal.'
   :'✏️ ГОС.ID · Редактирование обращения\n\nНапишите новый текст отдельным сообщением. Предыдущий текст не будет отправлен.');
  return true;
 }
 if(!text.startsWith('/')&&!isCallback){
  const {data:draft,error}=await db.from('telegram_appeal_drafts')
   .select('id,recipient_id,expires_at').eq('game_id',gameId).eq('author_id',userId)
   .eq('status','awaiting_text').gte('expires_at',new Date().toISOString())
   .order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  if(!draft)return false;
  const body=text.trim();
  if(body.length<10||body.length>4000){
   await reply('⚠️ ГОС.ID · Приёмная\n\nТекст должен содержать от 10 до 4000 символов. Попробуйте ещё раз.');
   return true;
  }
  const {data:updated,error:updateError}=await db.from('telegram_appeal_drafts')
   .update({body,source_message_id:messageId,status:'preview'})
   .eq('id',draft.id).eq('status','awaiting_text').select('id').maybeSingle();
  if(updateError)throw updateError;
  if(!updated)return true;
  await renderPreview(db,gameId,userId,draft.id,draft.recipient_id,body,reply);
  return true;
 }
 return false;
}
