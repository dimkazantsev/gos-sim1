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
  [{text:'📊 Состояние',callback_data:'gos:status'},{text:'🗺 Этапы',callback_data:'gos:stages'}],
  [{text:'🗳 Голосования',callback_data:'gos:votes'},{text:'📜 Документы',callback_data:'gos:docs'}],
  [{text:'💬 Чаты',callback_data:'gos:channels'},{text:'🏛 Мои игры',callback_data:'gos:games'}],
  [{text:'🏛 Личный аппарат',callback_data:'gos:office'},{text:'☀️ Доклад',callback_data:'gos:brief'}],
  [{text:'📅 Повестка',callback_data:'gos:agenda'},{text:'📌 Поручения',callback_data:'gos:tasks'}],
  [{text:'📥 Входящие',callback_data:'gos:inbox'},{text:'📰 Новости',callback_data:'gos:news'}],
  [{text:'🚨 Ситуации',callback_data:'gos:crises'},{text:'📈 Экономика',callback_data:'gos:economy'}],
  [{text:'📨 Приёмная',callback_data:'gos:appeals'},{text:'✍️ Написать обращение',callback_data:'gos:appeal'}],
  [{text:'🏅 Карьера',callback_data:'gos:career'},{text:'⚖️ НПА',callback_data:'gos:legal'}],
  [{text:'🎓 Блиц',callback_data:'gos:training'},{text:'⚙️ Настройки',callback_data:'gos:settings'}],
  [{text:'❔ Помощь',callback_data:'gos:help'}],
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
 {command:'menu',description:'🏛 Главное меню бота'},
 {command:'games',description:'🏛 Мои игры'},
 {command:'status',description:'📊 Состояние республики'},
 {command:'stages',description:'🗺 Этапы и задачи'},
 {command:'votes',description:'🗳 Открытые голосования'},
 {command:'docs',description:'📜 Документы и НПА'},
 {command:'channels',description:'💬 Доступные чаты'},
 {command:'office',description:'🏛 Личный аппарат'},
 {command:'brief',description:'☀️ Служебный доклад'},
 {command:'agenda',description:'📅 Повестка и сроки'},
 {command:'tasks',description:'📌 Мои поручения'},
 {command:'inbox',description:'📥 Входящие документы'},
 {command:'news',description:'📰 Новости республики'},
 {command:'crises',description:'🚨 Ситуационный центр'},
 {command:'economy',description:'📈 Экономика'},
 {command:'career',description:'🏅 Служебная карьера'},
 {command:'legal',description:'⚖️ Правовая справочная'},
 {command:'training',description:'🎓 Подготовка к блицу'},
 {command:'settings',description:'⚙️ Настройки уведомлений'},
 {command:'appeals',description:'📨 Мои официальные обращения'},
 {command:'appeal',description:'✍️ Направить обращение'},
 {command:'reply',description:'📬 Ответить на обращение'},
 {command:'help',description:'❔ Справка и команды'}
];
const CALLBACK_TO_COMMAND:Record<string,string>={
 'gos:begin':'/menu','gos:menu':'/menu','gos:games':'/games',
 'gos:status':'/status','gos:stages':'/stages','gos:votes':'/votes',
 'gos:docs':'/docs','gos:channels':'/channels','gos:help':'/help',
 'gos:office':'/office','gos:brief':'/brief','gos:agenda':'/agenda',
 'gos:tasks':'/tasks','gos:inbox':'/inbox','gos:news':'/news',
 'gos:crises':'/crises','gos:economy':'/economy','gos:career':'/career',
 'gos:legal':'/legal','gos:training':'/training','gos:settings':'/settings',
 'gos:prefs:brief':'/settings_brief','gos:prefs:tasks':'/settings_tasks',
 'gos:prefs:mentions':'/settings_mentions','gos:prefs:documents':'/settings_documents',
 'gos:prefs:votes':'/settings_votes','gos:prefs:events':'/settings_events',
 'gos:prefs:quiet':'/settings_quiet',
 'gos:appeals':'/appeals','gos:appeal':'/appeal'
};
export function telegramCallbackCommand(data:string):string|undefined{
 if(data==='gos:appeal:test')return '/appeal_test';
 const page=data.match(/^gos:appeal:page:([0-9]{1,2})$/);
 if(page)return '/appeal_page '+page[1];
 const action=data.match(/^gos:appeal:(pick|confirm|edit|cancel):([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i);
 if(action)return '/appeal_'+action[1]+' '+action[2];
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
  '📊 Состояние и 🗺 Этапы — информация о республике.',
  '🗳 Голосования и 📜 Документы — работа институтов.',
  '💬 Чаты — общение, 🏛 Мои игры — доступные республики.',
  '',
  connected?'✅ Ваш аккаунт подключён.':'🔐 Чтобы получить доступ к данным игры, привяжите Telegram в профиле ГОС.ID.',
  'Меню Telegram также доступно рядом с полем сообщения.'
 ].join('\n');
}
export function telegramHelpText(){
 return [
  '❔ ГОС.ID · Помощь',
  '',
  'Выберите действие с помощью кнопок или меню Telegram.',
  '/games — мои республики.',
  '/status — состояние республики.',
  '/stages — этапы и задачи.',
  '/votes — голосования.',
  '/docs — документы.',
  '/channels — чаты.',
  '/chat текст — написать в выбранный чат.',
  '/appeal — выбрать адресата, подготовить и подтвердить обращение.',
  '/appeal @Фамилия текст — подготовить обращение вручную.',
  '/appeal_test — проверка приёмной для преподавателя без отправки.'
  '/appeals — мои обращения.',
  '/reply КОД текст — ответить на входящее обращение.',
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
 // Some earlier cards stored escaped newline sequences as literal text.
 // Normalize them at the single Telegram delivery boundary, before escaping HTML.
 const normalized=text.replace(/\\r\\n|\\n|\\r/g,'\n').replace(/\r\n?/g,'\n')
  .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 let safe='',size=0,truncated=false;
 for(const char of normalized.replaceAll('GOS//SIMS','ГОС.ID')){
  const part=escapeTelegramHtml(char);
  if(size+part.length>3650){truncated=true;break}
  safe+=part;size+=part.length;
 }
 if(truncated)safe+='…';
 const newline=safe.indexOf('\n');
 // Bold only the title (first line); the body remains normal weight.
 const main=newline===-1?'<b>'+safe+'</b>':'<b>'+safe.slice(0,newline)+'</b>'+safe.slice(newline);
 return main+'\n\n🔗 <a href="'+TELEGRAM_PROJECT_URL+'">ГОС.ID</a>';
}
