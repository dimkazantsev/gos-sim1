/** Telegram's own markup controls are kept independent of the game UI and database. */
export const TELEGRAM_PROJECT_URL='https://dimkazantsev.github.io/gos-sim1/';
export type TelegramButton={text:string;callback_data?:string;url?:string};
export type TelegramMarkup={inline_keyboard:TelegramButton[][]};
export const TELEGRAM_WELCOME_BUTTONS:TelegramMarkup={
 inline_keyboard:[
  [{text:'🚀 Начать',callback_data:'gos:begin'}],
  [{text:'🌐 Открыть ГОС.ID',url:TELEGRAM_PROJECT_URL}]
 ]
};
export const TELEGRAM_MENU_BUTTONS:TelegramMarkup={
 inline_keyboard:[
  [{text:'🏛 Мой аппарат',callback_data:'gos:office'},{text:'🌅 Доклад',callback_data:'gos:brief'}],
  [{text:'📥 Канцелярия',callback_data:'gos:inbox'},{text:'📌 Поручения',callback_data:'gos:deadlines'}],
  [{text:'🗓 Повестка',callback_data:'gos:agenda'},{text:'🚨 События',callback_data:'gos:alerts'}],
  [{text:'💬 Связь',callback_data:'gos:channels'},{text:'⚖️ Право',callback_data:'gos:law'}],
  [{text:'📰 Хроника',callback_data:'gos:news'},{text:'🏢 Приёмная',callback_data:'gos:reception'}],
  [{text:'📈 Экономика',callback_data:'gos:economy'},{text:'🏅 Карьера',callback_data:'gos:career'}],
  [{text:'🧠 Блиц',callback_data:'gos:blitz'},{text:'⚙️ Уведомления',callback_data:'gos:settings'}],
  [{text:'🗳 Голосования',callback_data:'gos:votes'},{text:'📜 НПА',callback_data:'gos:docs'}],
  [{text:'🎮 Мои игры',callback_data:'gos:games'},{text:'❔ Помощь',callback_data:'gos:help'}],
  [{text:'🌐 Открыть ГОС.ID',url:TELEGRAM_PROJECT_URL}]
 ]
};
/** Real public game deep links: no Vercel API URL or internal UUID-only path. */
export function telegramSectionUrl(section:'dashboard'|'stages'|'votes'|'documents'|'actions'|'profile'|'budget'|'events',id?:string){
 const url=new URL(TELEGRAM_PROJECT_URL);
 url.searchParams.set('section',section);
 if(section==='documents'&&id)url.searchParams.set('document',id);
 if(section==='profile'&&id==='tasks')url.searchParams.set('tasks','1');
 if(section==='dashboard'&&id){url.searchParams.set('openChat','1');url.searchParams.set('channel',id)}
 if(section==='votes'&&id)url.searchParams.set('vote',id);
 return url.toString();
}
export function telegramSectionButtons(section:'dashboard'|'stages'|'votes'|'documents'|'actions'|'profile'|'budget'|'events',label='Открыть раздел'):TelegramMarkup{
 return {inline_keyboard:[
  [{text:'↗ '+label,url:telegramSectionUrl(section)}],
  [{text:'🏛 Меню',callback_data:'gos:menu'},{text:'🌐 ГОС.ID',url:TELEGRAM_PROJECT_URL}]
 ]};
}
export function telegramTaskButtons():TelegramMarkup{
 return {inline_keyboard:[
  [{text:'📌 Открыть поручения',url:telegramSectionUrl('profile','tasks')}],
  [{text:'🏛 Меню',callback_data:'gos:menu'}]
 ]};
}
export function telegramChatButtons(channelId?:string):TelegramMarkup{
 return {inline_keyboard:[
  [{text:'💬 Перейти к беседе',url:telegramSectionUrl('dashboard',channelId)}],
  [{text:'🏛 Меню',callback_data:'gos:menu'}]
 ]};
}
export function telegramDocumentButtons(documents:{id:string;title:string}[]):TelegramMarkup{
 return {inline_keyboard:[
  ...documents.slice(0,10).map(d=>[{text:'📄 '+d.title.slice(0,48),url:telegramSectionUrl('documents',d.id)}]),
  [{text:'📜 Реестр НПА',url:telegramSectionUrl('documents')}],
  [{text:'🏛 Меню',callback_data:'gos:menu'}]
 ]};
}
export const TELEGRAM_BACK_BUTTONS:TelegramMarkup={
 inline_keyboard:[
  [{text:'🏛 Меню',callback_data:'gos:menu'},{text:'🌐 ГОС.ID',url:TELEGRAM_PROJECT_URL}]
 ]
};
export const TELEGRAM_COMMANDS=[
 {command:'start',description:'🚀 Начать работу с ГОС.ID'},
 {command:'menu',description:'🏛 Главное меню'},
 {command:'office',description:'🏛 Личный аппарат'},
 {command:'brief',description:'🌅 Государственный доклад'},
 {command:'inbox',description:'📥 Моя канцелярия'},
 {command:'deadlines',description:'📌 Поручения и сроки'},
 {command:'agenda',description:'🗓 Повестка и заседания'},
 {command:'alerts',description:'🚨 Адресные события'},
 {command:'channels',description:'💬 Чаты республики'},
 {command:'law',description:'⚖️ Правовые источники'},
 {command:'news',description:'📰 Государственная хроника'},
 {command:'reception',description:'🏢 Приёмная ведомства'},
 {command:'economy',description:'📈 Экономический бюллетень'},
 {command:'career',description:'🏅 Служебная карьера'},
 {command:'blitz',description:'🧠 Подготовка к блицу'},
 {command:'settings',description:'⚙️ Настройки уведомлений'},
 {command:'games',description:'🎮 Мои республики'},
 {command:'status',description:'📊 Состояние республики'},
 {command:'stages',description:'🗺 Этапы'},
 {command:'votes',description:'🗳 Голосования'},
 {command:'docs',description:'📜 Реестр НПА'},
 {command:'help',description:'❔ Справка'}
];
const CALLBACK_TO_COMMAND:Record<string,string>={
 'gos:begin':'/menu','gos:menu':'/menu','gos:games':'/games',
 'gos:status':'/status','gos:stages':'/stages','gos:votes':'/votes',
 'gos:docs':'/docs','gos:channels':'/channels','gos:help':'/help','gos:office':'/office','gos:brief':'/brief','gos:inbox':'/inbox','gos:deadlines':'/deadlines','gos:agenda':'/agenda','gos:alerts':'/alerts','gos:law':'/law','gos:news':'/news','gos:reception':'/reception','gos:economy':'/economy','gos:career':'/career','gos:blitz':'/blitz','gos:settings':'/settings'
};
export function telegramCallbackCommand(data:string):string|undefined{
 return Object.prototype.hasOwnProperty.call(CALLBACK_TO_COMMAND,data)?CALLBACK_TO_COMMAND[data]:undefined;
}
export function telegramWelcomeText(connected=false){
 return [
  '🏛 ГОС.ID — Цифровая платформа России',
  '',
  connected?'✅ Ваш Telegram подключён к ГОС.ID.':'👋 Добро пожаловать в ГОС.ID!',
  'Здесь вы будете получать сообщения о событиях республики и сможете следить за этапами, голосованиями и документами.',
  connected?'Нажмите «Начать», чтобы перейти к функциям бота.':'Нажмите «Начать», чтобы открыть меню. Для уведомлений из вашей игры привяжите Telegram в личном профиле ГОС.ID.',
  '',
  '⚡ Всё важное — в одном месте.'
 ].join('\n');
}
export function telegramMenuText(connected:boolean){
 return [
  '🏛 ГОС.ID · Главное меню',
  '',
  'Выберите раздел с помощью кнопок ниже.',
  'Ваш аппарат объединяет входящие документы, поручения, сроки и сообщения.',
  '«Доклад» показывает актуальную сводку, «Приёмная» — входящие обращения.',
  'Все действия учитывают ваши полномочия и текущую республику.',
  '',
  connected?'✅ Ваш аккаунт подключён.':'🔐 Чтобы получить доступ к данным игры, привяжите Telegram в профиле ГОС.ID.',
  'Кнопка «Меню» в Telegram остаётся доступной рядом с полем сообщения.'
 ].join('\n');
}
export function telegramHelpText(){
 return [
  '❔ ГОС.ID · Помощь',
  '',
  'Выберите действие с помощью кнопок или меню Telegram.',
  '/games — мои игры, /status — состояние, /stages — этапы.',
  '/votes — голосования, /docs — документы, /channels — чаты.',
  '/game UUID — указать игру при наличии нескольких.',
  '/channel UUID — выбрать доступный канал.',
  '/chat текст — отправить сообщение в выбранный канал.',
  '/office, /brief, /inbox, /agenda, /alerts — личный аппарат.',
  '/deadlines, /news, /reception, /economy, /career, /blitz — разделы.',
  '/law — официальные правовые источники; /settings — уведомления.',
  '/appeal UUID | тема | текст — направить обращение участнику.',
  '/menu — открыть главное меню.',
  '',
  'Для первой привязки перейдите в личный профиль на платформе.'
 ].join('\n');
}
export function escapeTelegramHtml(text:string){
 return text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
/** Always retain the verified linked signature at the very bottom. */
export function telegramMessageHtml(text:string){
 let safe='',size=0,truncated=false;
 for(const char of text.replaceAll('GOS//SIMS','ГОС.ID')){
  const part=escapeTelegramHtml(char);
  if(size+part.length>3650){truncated=true;break}
  safe+=part;size+=part.length;
 }
 if(truncated)safe+='…';
 const newline=safe.indexOf('\n');
 const main=newline===-1?'<b>'+safe+'</b>':'<b>'+safe.slice(0,newline)+'</b>'+safe.slice(newline);
 return main+'\n\n━━━━━━━━\n🔗 <a href="'+TELEGRAM_PROJECT_URL+'">ГОС.ID</a>';
}
