import {runtimeConfig} from './telegram';
import {telegramRepublicName,telegramSentence} from './telegramRepublicText';
import {telegramSectionButtons,telegramTaskButtons,telegramDocumentButtons} from './telegramPresentation';

type Db=ReturnType<typeof runtimeConfig>['db'];
type Card={text:string;buttons?:ReturnType<typeof telegramSectionButtons>};
type Section='office'|'brief'|'agenda'|'tasks'|'inbox'|'news'|'economy'|'career'|'crises'|'legal'|'training'|'settings';
const date=(value:string|null|undefined)=>value?new Date(value).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Barnaul'}):'не указана';
const safeTitle=(v:string|null|undefined)=>v?.trim()||'Без названия';
const printList=(a:string[])=>a.length?a.join('\n\n'):'Новых сведений нет.';

/** Each query is scoped to the already authenticated and active game membership. */
export async function telegramCabinetCard(db:Db,gameId:string,userId:string,section:Section):Promise<Card>{
 const memberResult=await db.from('game_members').select('role_title,full_name,kind,group_name,score').eq('game_id',gameId).eq('user_id',userId).is('roster_archived_at',null).maybeSingle();
 if(memberResult.error||!memberResult.data)throw new Error('Активное членство не подтверждено');
 const user=memberResult.data;
 if(user.kind==='observer')return {text:'🏛 ГОС.ID · Гостевой режим\n\nЛичные сведения и служебные действия доступны только участникам.',buttons:telegramSectionButtons('dashboard','Открыть ГОС.ID')};
 const [gameR,stagesR,tasksR,docsR,votesR]=await Promise.all([
  db.from('games').select('title,current_round,turn_open').eq('id',gameId).single(),
  db.from('game_stages').select('stage_no,title,status,deadline').eq('game_id',gameId).order('stage_no'),
  db.from('game_assigned_tasks').select('id,title,status,due_at,recipient_id,author_id,assigned_by').eq('game_id',gameId).or('recipient_id.eq.'+userId+',author_id.eq.'+userId+',assigned_by.eq.'+userId).order('due_at').limit(30),
  db.from('formal_document_deliveries').select('id,document_id,created_at,delivery_kind').eq('game_id',gameId).eq('recipient_id',userId).order('created_at',{ascending:false}).limit(20),
  db.from('game_votes').select('id,title,closed_at').eq('game_id',gameId).eq('status','open').limit(20)
 ]);
 for(const r of [gameR,stagesR,tasksR,docsR,votesR])if(r.error)throw r.error;
 const game=gameR.data,stages=stagesR.data||[],tasks=tasksR.data||[],docs=docsR.data||[],votes=votesR.data||[];
 const stage=stages.find(s=>s.stage_no===game?.current_round);
 const myTasks=tasks.filter(t=>t.recipient_id===userId&&t.status!=='confirmed');
 const heading='🏛 ГОС.ID · ';
 if(section==='office'||section==='brief'){
  const lines=[
   heading+(section==='brief'?'Служебный доклад':'Личный аппарат'),
   '',
   '👤 '+safeTitle(user.full_name),
   '🏷 '+telegramSentence((user.role_title||'Участник')+' · '+telegramRepublicName(user.group_name)),
   '📍 '+telegramSentence(stage?.title||'Этап не определён'),
   '',
   '📌 Поручения к исполнению: '+myTasks.length,
   '📥 Поступившие документы: '+docs.length,
   '🗳 Открытые голосования: '+votes.length,
   '📆 Ближайший срок: '+(myTasks.length?date(myTasks[0].due_at):'нет'),
   '',
   game?.turn_open?'🟢 Работа по этапу открыта.':'🕰 Ход закрыт.'
  ];
  return{text:lines.join('\n'),buttons:{inline_keyboard:[
   [{text:'📌 Мои поручения',callback_data:'gos:tasks'},{text:'📥 Входящие',callback_data:'gos:inbox'}],
   [{text:'📅 Повестка',callback_data:'gos:agenda'},{text:'📰 Новости',callback_data:'gos:news'}],
   [{text:'⚙️ Уведомления',callback_data:'gos:settings'}],
   [{text:'🌐 Мой профиль',url:'https://dimkazantsev.github.io/gos-sim1/?section=profile'}],
   [{text:'🏛 Главное меню',callback_data:'gos:menu'}]
  ]}};
 }
 if(section==='tasks')return{text:heading+'Мои поручения\n\n'+printList(myTasks.slice(0,12).map((t,i)=>(i+1)+'. '+safeTitle(t.title)+'\n   '+(t.status==='completed'?'Ожидает подтверждения':'В работе')+' · до '+date(t.due_at))),buttons:telegramTaskButtons()};
 if(section==='inbox'){
  const ids=[...new Set(docs.map(d=>d.document_id))];
  const result=ids.length?await db.from('formal_documents').select('id,title').eq('game_id',gameId).in('id',ids):{data:[],error:null};
  if(result.error)throw result.error;
  const available=(result.data||[]).map(d=>({id:d.id,title:d.title||'Документ'}));
  return{text:heading+'Входящие документы\n\n'+printList(available.slice(0,10).map((d,i)=>(i+1)+'. '+d.title)),buttons:telegramDocumentButtons(available)};
 }
 if(section==='agenda'){
  const open=stages.filter(s=>s.status==='open');
  return{text:heading+'Повестка\n\n'+printList([
   ...open.map(s=>'📍 '+safeTitle(s.title)+' · до '+date(s.deadline)),
   ...votes.slice(0,7).map(v=>'🗳 '+safeTitle(v.title)),
   ...myTasks.slice(0,7).map(t=>'📌 '+safeTitle(t.title)+' · до '+date(t.due_at))
  ]),buttons:telegramSectionButtons('stages','Перейти к этапам')};
 }
 if(section==='news'||section==='crises'){
  // Political process is the source of truth. game_events persists historical
  // entries after their associated wall posts have been soft-deleted.
  let query=db.from('political_posts').select('title,created_at')
   .eq('game_id',gameId).is('deleted_at',null);
  if(section==='crises')query=query.eq('process_type','crisis_response');
  const posts=await query.order('pinned',{ascending:false}).order('created_at',{ascending:false}).limit(5);
  if(posts.error)throw posts.error;
  const items=posts.data||[];
  return{text:heading+(section==='news'?'Новости игры':'Ситуационный центр')+'\n\n'+
   (items.length?printList(items.map((post,i)=>(i+1)+'. '+safeTitle(post.title)+'\n📅 '+date(post.created_at))):
    section==='news'?'В политическом процессе пока нет публикаций.':'В политическом процессе пока нет сообщений о кризисах.'),
   buttons:telegramSectionButtons('actions','Открыть политический процесс')};
 }
 if(section==='career'){
  const scores=await db.from('stage_assessments').select('stage_no,final_score,status').eq('game_id',gameId).eq('user_id',userId).order('stage_no',{ascending:false}).limit(12);
  if(scores.error)throw scores.error;
  return{text:heading+'Служебный путь\n\n👤 '+safeTitle(user.full_name)+'\n🏅 Рейтинг: '+(user.score??0)+'\n\n'+printList((scores.data||[]).map(s=>'Этап '+s.stage_no+': '+(s.status==='final'&&s.final_score!==null?s.final_score+' баллов':'оценка ещё не утверждена'))),buttons:telegramSectionButtons('profile','Открыть профиль')};
 }
 if(section==='economy')return{text:heading+'Экономический бюллетень\n\n📊 Бюджет и показатели экономики доступны в финансовом разделе платформы. Показатели не воспроизводятся без подтверждённых расчётов.',buttons:telegramSectionButtons('budget','Открыть бюджет')};
 if(section==='legal')return{text:heading+'Правовая справочная\n\n⚖️ Используйте реестр НПА для проверки компетенции, процедуры принятия решений и действующих редакций. Ответы на текущие задания и блиц не раскрываются.',buttons:telegramSectionButtons('documents','Открыть НПА')};
 if(section==='training')return{text:heading+'Подготовка и знания\n\n🎓 Тренировки и результаты блица доступны в ГОС.ID. Бот не раскрывает правильные ответы до завершения попытки.',buttons:telegramSectionButtons('stages','Открыть этапы')};
 const {data:settings,error:settingsError}=await db.from('telegram_notification_preferences').select('daily_brief,task_reminders,mentions,documents,votes,events,quiet_hours').eq('game_id',gameId).eq('user_id',userId).maybeSingle();
 if(settingsError)throw settingsError;
 const config=settings||{daily_brief:true,task_reminders:true,mentions:true,documents:true,votes:true,events:true,quiet_hours:false};
 const labels=[
  ['brief','☀️ Утренний доклад',config.daily_brief],
  ['tasks','📌 Поручения',config.task_reminders],
  ['mentions','💬 Упоминания',config.mentions],
  ['documents','📜 Документы',config.documents],
  ['votes','🗳 Голосования',config.votes],
  ['events','🚨 События',config.events],
  ['quiet','🌙 Тихие часы',config.quiet_hours]
 ] as const;
 return{text:heading+'Настройки уведомлений\n\nНажмите на категорию, чтобы включить или выключить её.\n\n🌙 Тихие часы: 22:00–08:00 (Барнаул).\n\n'+labels.map(([_,name,on])=>(on?'✅ ':'⚪ ')+name).join('\n'),
  buttons:{inline_keyboard:[
   ...labels.map(([key,name,on])=>[{text:(on?'✅ ':'⚪ ')+name,callback_data:'gos:prefs:'+key}]),
   [{text:'🏛 Меню',callback_data:'gos:menu'}]
  ]}
 };
}
