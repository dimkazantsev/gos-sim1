/**
 * ГОС.ID · Personal governmental office for Telegram.
 * Every command runs only AFTER the existing webhook verifies a connected
 * Telegram account and active game membership. Read-only cards use currently
 * published or participant-owned rows; no bypass of document voting/approval RPC.
 */
import type {runtimeConfig} from './telegram';
import {
 TELEGRAM_BACK_BUTTONS,telegramTaskButtons,telegramSectionButtons,
 telegramDocumentButtons,telegramChatButtons,telegramSectionUrl
} from './telegramPresentation';
import type {TelegramMarkup} from './telegramPresentation';

type DB=ReturnType<typeof runtimeConfig>['db'];
type Context={db:DB;gameId:string;userId:string;chatId:number;telegramId:number;messageId:number;text:string;command:string};
type Result={text:string;buttons?:TelegramMarkup};
const DATE_FORMAT: Intl.DateTimeFormatOptions={day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Barnaul'};
const date=(raw:string|null|undefined)=>raw?new Date(raw).toLocaleString('ru-RU',DATE_FORMAT)+' (Барнаул)':'не назначен';
const short=(v:string|null|undefined,max=140)=>(v||'').replace(/\s+/g,' ').trim().slice(0,max);
const bullet=(rows:string[],otherwise:string)=>rows.length?rows.join('\n') : otherwise;
const taskLabel=(s:string)=>s==='open'?'в работе':s==='completed'?'на подтверждении':'подтверждено';
const gameSec=(s:'dashboard'|'stages'|'votes'|'documents'|'actions'|'profile'|'budget'|'events')=>telegramSectionButtons(s,'Открыть в ГОС.ID');
const prefDefaults={daily_digest:true,notify_tasks:true,notify_documents:true,notify_messages:true,notify_events:true,quiet_start:null as string|null,quiet_end:null as string|null,timezone:'Asia/Barnaul'};

export async function telegramOfficeCommand(ctx:Context):Promise<Result|undefined>{
 const {db,gameId,userId,chatId,messageId,text,command}=ctx;
 const q=(table:string)=>db.from(table);
 const {data:me,error:memberError}=await q('game_members').select('kind,full_name,role_title,group_name,score').eq('game_id',gameId).eq('user_id',userId).is('roster_archived_at',null).maybeSingle();
 if(memberError||!me)return {text:'🔐 Ваши полномочия в республике больше не подтверждаются. Обновите привязку аккаунта.'};
 const {data:game}=await q('games').select('title,current_round,turn_open').eq('id',gameId).maybeSingle();
 const name=short(me.full_name,110)||'Участник';
 const role=short(me.role_title,140)||'Участник республики';
 if(command==='/office'||command==='/brief'){
  const [{data:tasks},{data:deliveries},{data:votes},{data:stage},{data:events}]=await Promise.all([
   q('game_assigned_tasks').select('id,title,status,due_at').eq('game_id',gameId).eq('recipient_id',userId).neq('status','confirmed').order('due_at',{ascending:true}).limit(8),
   q('formal_document_deliveries').select('id,document_id,delivery_kind,created_at').eq('game_id',gameId).eq('recipient_id',userId).order('created_at',{ascending:false}).limit(8),
   q('game_votes').select('id,title').eq('game_id',gameId).eq('status','open').limit(8),
   q('game_stages').select('title,deadline').eq('game_id',gameId).eq('stage_no',game?.current_round||1).maybeSingle(),
   q('event_assignments').select('id').eq('game_id',gameId).eq('recipient_id',userId).in('status',['open','pending']).limit(20)
  ]);
  const counts='📥 Документы: '+(deliveries?.length||0)+'\n📌 Поручения: '+(tasks?.length||0)+
   '\n🗳 Открытые голосования: '+(votes?.length||0)+'\n🚨 Назначенные события: '+(events?.length||0);
  const details=command==='/brief'?
   '\n\nБлижайшие поручения:\n'+bullet((tasks||[]).slice(0,4).map(t=>'• '+short(t.title,75)+' — '+date(t.due_at)),'Поручений на исполнении нет.'):'';
  return {text:'🏛 ГОС.ID · '+(command==='/brief'?'Государственный доклад':'Личный аппарат')+
   '\n\n👤 '+name+'\n🎖 '+role+'\n🏙 '+(game?.title||'Республика')+
   '\n📍 Текущий этап: '+(stage?.title||'ожидается')+'\n\n'+counts+details,
   buttons:{inline_keyboard:[
    [{text:'📥 Канцелярия',callback_data:'gos:inbox'},{text:'📌 Поручения',callback_data:'gos:deadlines'}],
    [{text:'🗓 Повестка',callback_data:'gos:agenda'},{text:'⚙️ Настройки',callback_data:'gos:settings'}],
    [{text:'🌐 Открыть профиль',url:telegramSectionUrl('profile')}]
   ]}};
 }
 if(command==='/inbox'){
  const [{data:deliveries},{data:tasks}]=await Promise.all([
   q('formal_document_deliveries').select('document_id,delivery_kind,destination,created_at').eq('game_id',gameId).eq('recipient_id',userId).order('created_at',{ascending:false}).limit(8),
   q('game_assigned_tasks').select('id,title,status,due_at').eq('game_id',gameId).eq('recipient_id',userId).neq('status','confirmed').order('due_at',{ascending:true}).limit(8)
  ]);
  const ids=[...new Set((deliveries||[]).map(d=>d.document_id))];
  const {data:docs}=ids.length?await q('formal_documents').select('id,title,status_label').eq('game_id',gameId).in('id',ids):{data:[]};
  const visible=(docs||[]).map(d=>({id:d.id,title:d.title}));
  return {text:'📥 ГОС.ID · Электронная канцелярия\n\n'+
   bullet((deliveries||[]).map(d=>{
    const doc=visible.find(x=>x.id===d.document_id);
    return '📜 '+short(doc?.title,95)+' · '+(d.delivery_kind==='sign'?'на подпись':'на рассмотрение');
   }),'Новых входящих документов нет.')+'\n\n📌 Поручения:\n'+
   bullet((tasks||[]).map(t=>'• '+short(t.title,85)+' ('+taskLabel(t.status)+')'),'Открытых поручений нет.')+
   '\n\nПодписание и юридически значимые действия выполняются только после проверки полномочий в ГОС.ID.',
   buttons:visible.length?telegramDocumentButtons(visible):telegramTaskButtons()};
 }
 if(command==='/deadlines'){
  const {data}=await q('game_assigned_tasks').select('title,status,due_at,requires_confirmation').eq('game_id',gameId).eq('recipient_id',userId).neq('status','confirmed').order('due_at',{ascending:true}).limit(25);
  return {text:'📌 ГОС.ID · Контроль поручений\n\n'+bullet((data||[]).map(t=>'• '+short(t.title,110)+'\n  '+date(t.due_at)+' · '+taskLabel(t.status)),'Открытых поручений нет.'),
    buttons:telegramTaskButtons()};
 }
 if(command==='/agenda'){
  const [{data:stages},{data:votes}]=await Promise.all([
   q('game_stages').select('title,deadline,status').eq('game_id',gameId).in('status',['open','active']).order('stage_no').limit(3),
   q('game_votes').select('title,opened_at').eq('game_id',gameId).eq('status','open').order('opened_at',{ascending:false}).limit(8)
  ]);
  return {text:'🗓 ГОС.ID · Повестка республики\n\n📍 Этапы:\n'+
   bullet((stages||[]).map(s=>'• '+short(s.title,120)+' — '+date(s.deadline)),'Открытых этапов нет.')+
   '\n\n🗳 Голосования:\n'+bullet((votes||[]).map(v=>'• '+short(v.title,125)),'Открытых голосований нет.')+
   '\n\nРегистрация на заседания и голосование выполняются в игре по установленной процедуре.',buttons:gameSec('votes')};
 }
 if(command==='/alerts'){
  const {data:assignments}=await q('event_assignments').select('case_id,status,created_at').eq('game_id',gameId).eq('recipient_id',userId).order('created_at',{ascending:false}).limit(8);
  const ids=[...new Set((assignments||[]).map(x=>x.case_id))];
  const {data:cases}=ids.length?await q('event_cases').select('id,title').eq('game_id',gameId).in('id',ids):{data:[]};
  return {text:'🚨 ГОС.ID · События по компетенции\n\n'+bullet((assignments||[]).map(a=>{
   const event=cases?.find(x=>x.id===a.case_id);
   return '• '+short(event?.title,150)+' — '+(a.status==='open'?'требует решения':short(a.status,40));
  }),'Сейчас вам не назначены события.')+'\n\nВарианты решений и последствия открываются только в игровом интерфейсе.',buttons:gameSec('events')};
 }
 if(command==='/law'){
  // Deliberately select legal bibliographic metadata ONLY, never question, options,
  // correct_index or explanation from the blitz bank.
  const {data}=await q('blitz_questions').select('legal_act,article,source_url').eq('verified',true).not('source_url','is',null).limit(90);
  const unique=new Map<string,{legal_act:string|null;article:string|null;source_url:string|null}>();
  for(const x of data||[]){if(x.source_url?.startsWith('https://')&&!unique.has(x.source_url))unique.set(x.source_url,x)}
  const entries=[...unique.values()].slice(0,8);
  return {text:'⚖️ ГОС.ID · Правовой справочник\n\n'+bullet(entries.map(x=>'• '+short(x.legal_act,105)+(x.article?' · ст. '+short(x.article,25):'')+'\n  '+x.source_url),'Верифицированных ссылок пока нет.')+
   '\n\nЭто перечень источников, а не подсказки или ответы на проверочные задания.',buttons:gameSec('documents')};
 }
 if(command==='/news'||command==='/history'){
  const filter=q('political_posts').select('title,created_at').eq('game_id',gameId).is('deleted_at',null);
  const {data}=command==='/history'?
   await filter.eq('author_id',userId).in('status',['published','accepted']).order('created_at',{ascending:false}).limit(10):
   await filter.eq('status','published').order('created_at',{ascending:false}).limit(10);
  return {text:'📰 ГОС.ID · '+(command==='/history'?'Моя хроника':'Государственная хроника')+'\n\n'+
    bullet((data||[]).map(x=>'• '+date(x.created_at)+' — '+short(x.title,140)),'Опубликованных новостей пока нет.'),buttons:gameSec('actions')};
 }
 if(command==='/reception'){
  const {data}=await q('telegram_reception_requests')
   .select('id,subject,status,created_at,sender_id,recipient_id').eq('game_id',gameId)
   .or('sender_id.eq.'+userId+',recipient_id.eq.'+userId)
   .order('created_at',{ascending:false}).limit(12);
  return {text:'🏢 ГОС.ID · Приёмная\n\n'+bullet((data||[]).map(a=>
   '• '+short(a.subject,105)+' — '+(a.status==='received'?'зарегистрировано':a.status==='processing'?'на рассмотрении':a.status==='answered'?'получен ответ':'закрыто')+'\n   ID: '+a.id
  ),'Обращений пока нет.')+
   '\n\nОтправить: /appeal @Фамилия | Тема | Текст\nОтветить на адресованное вам обращение: /answer UUID_обращения | Текст ответа.',
   buttons:gameSec('profile')};
 }
 if(command==='/appeal'){
  const raw=text.slice(text.indexOf(' ')+1);
  const match=raw.match(/^([^|]{2,100})\s*\|\s*([^|]{3,160})\s*\|\s*([\s\S]{5,3000})$/i);
  if(!match)return {text:'🏢 Формат обращения:\n/appeal @Фамилия | Тема (3–160 знаков) | Текст (5–3000 знаков)'};
  const [,handle,subject,body]=match;
  const cleaned=handle.trim().replace(/^@/,'').toLocaleLowerCase('ru-RU');
  const {data:people}=await q('game_members').select('user_id,full_name,role_title').eq('game_id',gameId)
   .is('roster_archived_at',null).neq('kind','observer').limit(200);
  const matches=(people||[]).filter(p=>p.user_id.toLowerCase()===cleaned||
    p.full_name.trim().split(/\s+/)[0]?.toLocaleLowerCase('ru-RU')===cleaned);
  if(matches.length!==1)return {text:matches.length>1?
   'В республике несколько участников с такой фамилией. Для точного адресата используйте UUID участника из его профиля.':
   'Участник с указанной фамилией не найден в вашей республике.'};
  const target=matches[0];
  if(target.user_id===userId)return {text:'Адресатом обращения должен быть другой участник.'};
  const recipient=target.user_id;
  const {error}=await q('telegram_reception_requests').insert({
   game_id:gameId,sender_id:userId,recipient_id:recipient,subject:subject.trim(),body:body.trim(),
   telegram_chat_id:chatId,telegram_message_id:messageId
  });
  if(error&&error.code!=='23505')throw error;
  return {text:'🏢 ГОС.ID · Приёмная\n\n'+(error?'Это обращение уже было зарегистрировано.':'✅ Обращение зарегистрировано.')+
   '\nАдресат: '+short(target.full_name,110)+'\nТема: '+short(subject,160)+'\nСтатус: принято к рассмотрению.',
   buttons:gameSec('profile')};
 }
 if(command==='/answer'){
  const match=text.match(/^\/answer\s+([0-9a-f-]{36})\s*\|\s*([\s\S]{3,3000})$/i);
  if(!match)return {text:'🏢 Формат ответа: /answer UUID_обращения | Текст ответа (3–3000 знаков).'};
  const [,requestId,responseText]=match;
  const {data:pending}=await q('telegram_reception_requests').select('id,subject,status')
   .eq('id',requestId).eq('game_id',gameId).eq('recipient_id',userId).maybeSingle();
  if(!pending)return {text:'Обращение не найдено или ответ на него вам не поручен.'};
  if(pending.status==='answered'||pending.status==='closed')return {text:'На это обращение уже дан ответ или оно закрыто.'};
  const {data:updated,error}=await q('telegram_reception_requests')
   .update({answer:responseText.trim(),answered_at:new Date().toISOString(),answer_message_id:messageId,status:'answered'})
   .eq('id',requestId).eq('game_id',gameId).eq('recipient_id',userId)
   .in('status',['received','processing']).select('id').maybeSingle();
  if(error)throw error;
  if(!updated)return {text:'Ответ уже отправлен другим действием. Повторно не отправляем.'};
  return {text:'✅ ГОС.ID · Приёмная\n\nОтвет на обращение «'+short(pending.subject,110)+
   '» зарегистрирован и направлен отправителю.',buttons:TELEGRAM_BACK_BUTTONS};
 }
 if(command==='/economy'){
  // Only approved and formally published budget objects, not internal drafts.
  const {data}=await q('budget_simulator_plans').select('title,status,updated_at')
   .eq('game_id',gameId).in('status',['published','approved','signed','adopted']).order('updated_at',{ascending:false}).limit(5);
  return {text:'📈 ГОС.ID · Экономический бюллетень\n\n'+
   bullet((data||[]).map(x=>'• '+short(x.title,145)+' · '+date(x.updated_at)),'Опубликованного бюджета пока нет.')+
   '\n\nНеутверждённые расчёты и черновики ведомств не раскрываются.',buttons:gameSec('budget')};
 }
 if(command==='/career'){
  const {count}=await q('game_assigned_tasks').select('id',{count:'exact',head:true}).eq('game_id',gameId).eq('recipient_id',userId).eq('status','confirmed');
  return {text:'🏅 ГОС.ID · Служебная карьера\n\n👤 '+name+'\n🏛 Должность: '+role+
   '\n👥 Группа: '+short(me.group_name,80)+'\n⭐ Баллы: '+String(me.score??0)+
   '\n✅ Подтверждённые поручения: '+String(count||0)+
   '\n\nСведения о наградах отображаются в игровом профиле; непроверенные награды бот не присваивает.',buttons:gameSec('profile')};
 }
 if(command==='/blitz'){
  const {data}=await q('blitz_assignments').select('answered_at,is_correct').eq('game_id',gameId).eq('user_id',userId).limit(1000);
  const answered=(data||[]).filter(x=>!!x.answered_at);
  const correct=answered.filter(x=>x.is_correct===true).length;
  const pending=(data||[]).filter(x=>!x.answered_at).length;
  return {text:'🧠 ГОС.ID · Правовая подготовка\n\n✅ Правильных ответов: '+correct+
    '\n📝 Завершено попыток: '+answered.length+'\n⏳ Ожидают прохождения: '+pending+
    '\n\nДля подготовки откройте раздел «Блиц» в ГОС.ID. Правильные ответы на незавершённые попытки в Telegram не передаются.',
    buttons:gameSec('stages')};
 }
 if(command==='/settings'){
  const {data:existing}=await q('telegram_bot_preferences').select('*').eq('game_id',gameId).eq('user_id',userId).maybeSingle();
  const pref={...prefDefaults,...(existing||{})};
  const args=text.split(/\s+/);
  if(args[1]){
   const permitted=new Set(['digest','tasks','documents','messages','events','quiet','timezone']);
   if(!permitted.has(args[1]))return {text:'⚙️ Допустимо: /settings digest on|off, tasks, documents, messages, events on|off, quiet ЧЧ:ММ ЧЧ:ММ, timezone Asia/Barnaul|Asia/Novosibirsk|Europe/Moscow|UTC'};
   const patch:Record<string,unknown>={game_id:gameId,user_id:userId,updated_at:new Date().toISOString()};
   if(args[1]==='quiet'){
    if(args[2]==='off'){patch.quiet_start=null;patch.quiet_end=null}
    else if(/^\d{2}:\d{2}$/.test(args[2]||'')&&/^\d{2}:\d{2}$/.test(args[3]||'')){
     const good=(t:string)=>{const [h,m]=t.split(':').map(Number);return h<24&&m<60};
     if(!good(args[2])||!good(args[3]))return{text:'Укажите корректные часы от 00:00 до 23:59.'};
     patch.quiet_start=args[2];patch.quiet_end=args[3];
    }else return {text:'Пример: /settings quiet 22:00 08:00\nОтключение: /settings quiet off'};
   }else if(args[1]==='timezone'){
    if(!['Asia/Barnaul','Asia/Novosibirsk','Europe/Moscow','UTC'].includes(args[2]||''))return {text:'Допустимые пояса: Asia/Barnaul, Asia/Novosibirsk, Europe/Moscow, UTC.'};
    patch.timezone=args[2];
   }else{
    if(!['on','off'].includes(args[2]||''))return {text:'Укажите on или off, например /settings digest off'};
    patch[args[1]==='digest'?'daily_digest':'notify_'+args[1]]=args[2]==='on';
   }
   const {error}=await q('telegram_bot_preferences').upsert(patch,{onConflict:'game_id,user_id'});
   if(error)throw error;
   Object.assign(pref,patch);
  }
  const yn=(v:boolean)=>v?'включено':'отключено';
  return {text:'⚙️ ГОС.ID · Настройки уведомлений\n\n🌅 Утренний доклад: '+yn(pref.daily_digest)+
   '\n📌 Поручения: '+yn(pref.notify_tasks)+'\n📜 Документы: '+yn(pref.notify_documents)+
   '\n💬 Сообщения: '+yn(pref.notify_messages)+'\n🚨 События: '+yn(pref.notify_events)+
   '\n🌙 Тихие часы: '+(pref.quiet_start?pref.quiet_start+'–'+pref.quiet_end:'не заданы')+
   '\n🌐 Часовой пояс: '+pref.timezone+
   '\n\nИзменение: /settings digest on|off\n/settings tasks off\n/settings quiet 22:00 08:00\n/settings timezone Asia/Barnaul',
   buttons:TELEGRAM_BACK_BUTTONS};
 }
 return undefined;
}
