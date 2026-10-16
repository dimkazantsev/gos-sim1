/** Public results saved by the stage-completion trigger. Never derive a winner or a legal status from a draft. */
export const COMIC_STAGES=[1,3,5,7,8,11,12,13,14,15,16] as const;
export type ComicIcon='people'|'party'|'person'|'regions'|'parliament'|'vote'|'document'|'check'|'money'|'program'|'city'|'shield'|'message'|'award'|'clock';
export type ComicFact={icon:ComicIcon;label:string;value:string;detail?:string};
type ResultRow={id?:string;name?:string;title?:string;status?:string;leader?:string|null;role?:string;party?:string|null;mandates?:number;regions?:number;ghost_loss?:number;amount?:number|string;revenue?:number;expenditure?:number;balance?:number;year?:number;result?:string|null;score?:number|null;system?:string;unit?:string|null;value?:number;method?:string};
export type ComicSnapshot={version?:number;source?:'completed'|'reconstructed';captured_at?:string;stages?:number[];counters?:Record<string,number>;parties?:ResultRow[];offices?:ResultRow[];documents_detail?:ResultRow[];votes_detail?:ResultRow[];programs?:ResultRow[];municipal_projects?:ResultRow[];crises?:ResultRow[];budgets?:ResultRow[];metrics_detail?:ResultRow[];president?:ResultRow|null;election_rules?:ResultRow[];regional_rules?:ResultRow[];ministries?:ResultRow[];documents?:number;votes?:number;finished_documents?:number;passed_votes?:number};
export type ComicChapter={id:string;game_id?:string;stage_no:number;kind:'completed'|'preview';title:string;body:string;snapshot:ComicSnapshot;created_at:string};
export type ComicSlide={title:string;body:string;art:string;facts:ComicFact[]};
export const COMIC_THEMES:Record<number,{title:string;art:string}>={
 1:{title:'Партии вышли на политическую сцену',art:'parties'},3:{title:'Правила выборов и регионы',art:'regions'},5:{title:'Государственная Дума начала работу',art:'duma'},7:{title:'Выборы Президента',art:'president'},8:{title:'Руководство Правительства',art:'government'},11:{title:'Решения по государственным программам',art:'programs'},12:{title:'Законодательные решения',art:'laws'},13:{title:'Федеральный бюджет',art:'budget'},14:{title:'Решения для муниципалитетов',art:'municipal'},15:{title:'Государство в условиях кризиса',art:'crisis'},16:{title:'Эпилог · Итоги игры',art:'epilogue'}
};
export function comicStages(stage:number){return stage===3?[2,3]:stage===5?[4,5]:stage===16?Array.from({length:16},(_,i)=>i+1):[stage]}
/** Visual drafts are local to the teacher. They are never saved or considered completed results. */
export function teacherComicPreviews(gameId:string,stored:ComicChapter[]):ComicChapter[]{
 const existing=new Set(stored.map(c=>c.stage_no));
 return COMIC_STAGES.filter(stage=>!existing.has(stage)).map(stage=>({
  id:'teacher-preview:'+gameId+':'+stage,game_id:gameId,stage_no:stage,kind:'preview' as const,
  title:COMIC_THEMES[stage].title,body:'Предварительный просмотр оформления. Итоги появятся после завершения этапов.',
  snapshot:{version:2,counters:{}},created_at:''
 }));
}
export function eligibleComicStages(stages:{stage_no:number;status:string}[]){
 const completed=new Set(stages.filter(s=>s.status==='completed').map(s=>s.stage_no));
 return COMIC_STAGES.filter(no=>completed.has(no)&&(no===3||no===5?comicStages(no).every(n=>completed.has(n)):true));
}
const labels:Record<string,string>={draft:'Черновик',submitted:'На рассмотрении',registered:'Зарегистрирована',revision:'Доработка',rejected:'Отклонено',adopted:'Принято',approved:'Утверждено',published:'Опубликовано',signed:'Подписано',ready:'Подписана · Готова к заседанию',government_vote:'Голосование Правительства',minister_review:'У министра',pm_review:'На подписи Председателя Правительства',passed:'Принято',no_quorum:'Нет кворума',open:'Открыто',closed:'Завершено',resolved:'Разрешён',active:'Активно',relative:'Относительное большинство',absolute:'Абсолютное большинство',qualified:'Квалифицированное большинство',preferential:'Преференциальная система',proportional:'Пропорциональная',majoritarian:'Мажоритарная',mixed:'Смешанная',random:'Случайный метод',democratic:'Демократический метод',negotiated:'Договорный метод',agreement:'Договорный метод'};
const fmt=(n:number)=>n.toLocaleString('ru-RU',{maximumFractionDigits:2});
const ruleLabels:Record<string,string>={final:'Расчёт зафиксирован',allocated:'Распределено',vote_open:'На голосовании',superseded:'Заменено новым решением',granted:'Предоставлено',requested:'Запрошено',hare:'Квота Хэйра',droop:'Квота Друпа',dhondt:'Д’Ондт',sainte_lague:'Сент-Лагю',imperiali:'Империали',plurality:'Относительное большинство',absolute_two_round:'Абсолютное большинство · два тура'};
const money=(n:number|string|undefined)=>n==null?'Не зафиксировано':Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const status=(s:string|undefined)=>s?ruleLabels[s]||labels[s]||s:'Не зафиксировано';
export function comicSlides(chapter:ComicChapter):ComicSlide[]{
 const s=chapter.snapshot||{},no=chapter.stage_no,theme=COMIC_THEMES[no];
 if(s.version!==2||!theme)return [{title:chapter.title,body:chapter.body,art:no===16?'epilogue':no>=9?'programs':'regions',facts:[]}];
 if(chapter.kind==='preview'){
  const draft=comicSlides({...chapter,kind:'completed'});
  return draft.map(slide=>({...slide,
   body:'Предварительный просмотр для преподавателя. После завершения '+(comicStages(no).length===2?'обоих этапов':'этапа')+' вместо заглушек появятся сохранённые результаты игры. Это не фактический итог.',
   facts:slide.facts.map(fact=>({...fact,value:'Ожидает завершения',detail:undefined}))
  }));
 }
 const c=s.counters||{};
 const count=(key:string,label:string,icon:ComicIcon='check'):ComicFact=>({icon,label,value:typeof c[key]==='number'?fmt(c[key]):'Не зафиксировано'});
 const rows=(items:ResultRow[]|undefined,icon:ComicIcon,detail:(r:ResultRow)=>string):ComicFact[]=>items?.length?items.map(r=>({icon,label:r.name||r.title||r.role||'Запись',value:detail(r)})):[{icon,label:'Результат',value:'Нет зафиксированных записей'}];
 const offices=(pattern:RegExp)=>rows(s.offices?.filter(r=>pattern.test(r.role||'')),'person',r=>r.role||'Должность не указана');
 const decisions:ComicFact[]=[...rows(s.documents_detail,'document',r=>status(r.status)),...rows(s.votes_detail,'vote',r=>status(r.result||r.status))];
 const slide=(title:string,body:string,facts:ComicFact[],art=theme.art):ComicSlide=>({title,body,facts,art});
 const procedures=[count('documents','Документов','document'),count('finished_documents','Завершённых документов','check'),count('votes','Голосований','vote'),count('passed_votes','Принятых решений','check')];
 switch(no){
 case 1:{
  const unregistered=s.parties?.filter(p=>p.status!=='registered')||[];
  const hasRegistrationOutcome=unregistered.length>0||['documents','finished_documents','votes','passed_votes'].some(key=>(c[key]||0)>0);
  return [
  slide('Новые участники политической жизни','Учредительный этап завершён. Здесь показаны партии, чья регистрация отражена в реестре игры.',[count('parties','Всего партий','party'),count('registered_parties','Зарегистрировано','check'),count('party_members','Участников в партиях','people')]),
  slide('Зарегистрированные партии','Названия и председатели сохранены из реестра при завершении этапа.',rows(s.parties?.filter(p=>p.status==='registered'),'party',p=>'Председатель: '+(p.leader||'Не назначен'))),
  ...(hasRegistrationOutcome?[slide('Регистрационные итоги','Стадия подготовки и итог процедуры учитываются отдельно.',[...procedures,...rows(unregistered,'party',p=>status(p.status))])]:[])];
 }
 case 3:return [
  slide('Как проводятся выборы','Сохранены выбранные модели и их фактический статус. Проект решения ещё не означает его принятия.',[...rows(s.election_rules,'vote',r=>status(r.system)+(r.method?' · '+status(r.method):'')+' · '+status(r.status)),...rows(s.regional_rules,'regions',r=>status(r.method)+' · '+status(r.status))]),
  slide('Региональное представительство','Распределение контроля над субъектами РФ по данным игры.',rows(s.parties,'party',p=>fmt(p.regions||0)+' субъектов РФ')),
  slide('Общие итоги этапов 2 и 3','Документы и голосования обоих этапов собраны в одну главу.',[...procedures,...decisions])];
 case 5:return [
  slide('Состав Государственной Думы','Мандаты фракций зафиксированы вместе с итогами первого заседания.',rows(s.parties,'parliament',p=>fmt(p.mandates||0)+' мандатов')),
  slide('Руководство палаты','Действующие назначения и избранные руководители по данным игры.',offices(/дум|комитет|совет гд/i)),
  slide('Голоса и участие в заседаниях','Результаты этапов 4 и 5: представительство, доступные голоса и принятые решения.',[count('mandates','Мандатов','parliament'),count('ghost_loss','Потери голосов GV','vote'),...rows(s.parties,'party',p=>fmt(Math.max(0,(p.mandates||0)-(p.ghost_loss||0)))+' доступных голосов'),...procedures])];
 case 7:return [
  slide('Результат президентских выборов',s.president?'Победитель указан в завершённом расчёте выборов.':'В данных этапа пока нет подтверждённого победителя.',s.president?[{icon:'person',label:'Избранный Президент',value:s.president.name||'Не зафиксирован',detail:s.president.party||'Самовыдвижение'},{icon:'vote',label:'Итоговый результат',value:s.president.score==null?'Не зафиксировано':fmt(s.president.score)+'%'},{icon:'vote',label:'Избирательная система',value:status(s.president.system)}]:[{icon:'person',label:'Избранный Президент',value:'Результат не зафиксирован'}]),
  slide('Кандидаты и регистрация','Итоги регистрации кандидатов и принятые документы сохранены без приватных материалов ЦИК.',[count('candidates','Кандидатов','people'),count('registered_candidates','Зарегистрировано','check'),...decisions]),
  slide('Президент в системе власти','Действующие полномочия отражены только по подтверждённым назначениям.',[...offices(/^президент(?:\s|$)/i),...procedures])];
 case 8:return [
  slide('Кто возглавил Правительство','ФИО назначенных руководителей сохранены из состава органов власти.',offices(/председатель правительства|председатель.*банка|председатель.*банк|банк.*россии/i)),
  slide('Структура министерств','Состав ведомств и решения о структуре Правительства по данным этапа.',[...rows(s.ministries,'program',r=>status(r.status)),...decisions]),
  slide('Итоги назначения руководства','Имена, должности и результаты процедур остаются в этой главе после перехода к следующему этапу.',[...procedures,...offices(/правительств|банк.*россии/i)])];
 case 11:return [
  slide('Программы на рассмотрении Правительства','Показаны программы и фактические решения по ним.',[count('programs','Государственных программ','program'),count('adopted_programs','Принято Правительством','check'),count('signed_programs','Подписано Председателем','document')]),
  slide('Решения по программам','Название, статус и финансирование каждой программы из сохранённого реестра.',rows(s.programs,'program',p=>status(p.status)+' · '+money(p.amount))),
  slide('Заседание Правительства','Результаты документов и голосований этого этапа.',[...procedures,...decisions])];
 case 12:return [
  slide('Законодательная работа','Документы считаются по реестру; принятие, подписание и опубликование показаны отдельно.',procedures),
  slide('Что произошло с законопроектами','Фактическая стадия каждого документа без автоматического признания его законом.',rows(s.documents_detail,'document',r=>status(r.status))),
  slide('Решения палаты','Результаты голосований по законопроектам и поправкам.',rows(s.votes_detail,'vote',r=>status(r.result||r.status)))];
 case 13:return [
  slide('Федеральный бюджет','Показаны сохранённые расчёты и статус бюджетного документа.',rows(s.budgets,'money',r=>(r.year||'Год не указан')+' · '+status(r.status))),
  slide('Доходы, расходы и баланс','Единица расчётов бюджетных сценариев — трлн ₽. Черновые расчёты отмечены своим статусом.',s.budgets?.length?s.budgets.flatMap(b=>[{icon:'money' as const,label:(b.title||'Бюджет')+' · Доходы',value:b.revenue==null?'Не зафиксировано':fmt(b.revenue)+' трлн ₽'},{icon:'money' as const,label:'Расходы',value:b.expenditure==null?'Не зафиксировано':fmt(b.expenditure)+' трлн ₽'},{icon:'money' as const,label:'Баланс',value:b.balance==null?'Не зафиксировано':fmt(b.balance)+' трлн ₽'}]):[{icon:'money',label:'Бюджет',value:'Расчёты не зафиксированы'}]),
  slide('Принятие бюджета','Результаты законодательной процедуры и согласованных трансфертов.',[...procedures,count('transfers','Запросов трансфертов','regions'),count('approved_transfers','Утверждённых трансфертов','check'),...decisions])];
 case 14:return [
  slide('Муниципальные проекты','Проекты территорий по фактическим материалам участников.',[count('municipal_projects','Проектов','city'),count('municipal_districts','Территорий','regions')]),
  slide('Что предложено территориям','Названия проектов, суммы и результаты рассмотрения.',rows(s.municipal_projects,'city',p=>status(p.status)+' · '+money(p.amount))),
  slide('Решения местной власти','Руководители территорий и итоги процедур этапа.',[...offices(/муницип|мэр|район/i),...procedures,...decisions])];
 case 15:return [
  slide('Кризисы и конфликты','События и результаты антикризисного этапа по записям игры.',[count('crises','Кризисов','shield'),count('resolved_crises','Завершённых кризисов','check'),count('crisis_responses','Антикризисных планов','document')]),
  slide('Реакция органов власти','Зафиксированные кризисы и их фактический статус.',rows(s.crises,'shield',r=>status(r.status))),
  slide('Антикризисные решения','Документы, голосования и публичные показатели на момент сохранения главы.',[...procedures,...rows(s.metrics_detail,'program',r=>r.value==null?'Не зафиксировано':fmt(r.value)+(r.unit?' '+r.unit:'')),...decisions])];
 case 16:return [
  slide('Люди и государственные институты','Все показатели относятся только к этой игре и сохранены при завершении этапа 16.',[count('participants','Всего участников','people'),count('students','Граждан / участников','person'),count('teachers','Администраторов','person'),count('observers','Наблюдателей','person'),count('archived_members','Архивных участников','people'),count('completed_stages','Завершённых этапов','check'),count('parties','Партий','party'),count('registered_parties','Зарегистрированных партий','check'),count('party_members','Участников партий','people'),count('mandates','Мандатов','parliament'),count('regions','Субъектов в распределении','regions'),count('offices','Действующих назначений','person'),count('candidates','Кандидатов в Президенты','person'),count('registered_candidates','Зарегистрированных кандидатов','check')]),
  slide('Право и публичные решения','Общее число документов, процедур и голосований; персональные бюллетени не раскрываются.',[count('documents','Документов','document'),count('finished_documents','Завершённых документов','check'),count('published_documents','Опубликованных документов','document'),count('document_revisions','Редакций документов','document'),count('votes','Голосований','vote'),count('closed_votes','Закрытых голосований','vote'),count('passed_votes','Принятых решений','check'),count('rejected_votes','Отклонённых решений','vote'),count('no_quorum_votes','Без кворума','vote'),count('ballots','Поданных бюллетеней','vote'),count('sessions','Заседаний Государственной Думы','parliament'),count('completed_sessions','Завершённых заседаний','check')],'laws'),
  slide('Программы, бюджет и управление','Суммарные показатели государственных программ, территорий, ситуаций и кризисов.',[count('programs','Государственных программ','program'),count('adopted_programs','Принятых программ','check'),count('signed_programs','Подписанных программ','document'),count('budget_scenarios','Бюджетных расчётов','money'),count('transfers','Запросов трансфертов','money'),count('approved_transfers','Утверждённых трансфертов','check'),count('municipal_districts','Муниципальных территорий','regions'),count('municipal_projects','Муниципальных проектов','city'),count('crises','Кризисов','shield'),count('resolved_crises','Завершённых кризисов','check'),count('crisis_responses','Антикризисных планов','document'),count('event_assignments','Назначенных ситуаций','shield'),count('event_decisions','Ответов на ситуации','check'),count('event_outcomes','Обработанных результатов','check')],'programs'),
  slide('Обсуждение и участие','Количество сохранённых публикаций, сообщений, ответов, задач и наград.',[count('posts','Публикаций','document'),count('comments','Комментариев','message'),count('reactions','Реакций','message'),count('messages','Сообщений в чатах','message'),count('files','Файлов в чатах','document'),count('audio','Аудиосообщений','message'),count('video','Видеосообщений','message'),count('blitz_assigned','Назначенных блиц-вопросов','clock'),count('blitz_answered','Ответов на блиц','check'),count('debriefs','Разборов этапов','document'),count('assessments','Подтверждённых оценок','check'),count('awards','Выданных наград','award'),count('tasks','Назначенных задач','document'),count('completed_tasks','Выполненных задач','check')])];
 default:return [];
 }
}
