import type {ReturnTypeRepublic} from './viewTypes';

const STAGE_ACTIONS:Record<number,{title:string;body:string;target:'parties'|'votes'|'documents'|'actions';button:string}>={
 1:{title:'Создайте и соберите партию',body:'Определите идеологию, распределите роли и выберите председателя.',target:'parties',button:'Перейти к партии'},
 2:{title:'Подготовьте позицию по избирательной системе',body:'Обсудите модель выборов внутри команды и сформулируйте общую позицию.',target:'votes',button:'Перейти к голосованию'},
 3:{title:'Работайте с политической картой',body:'Следите за поддержкой партии, мандатами, регионами и ресурсами.',target:'parties',button:'Открыть политическую карту'},
 4:{title:'Подготовьте парламентскую позицию',body:'Сформулируйте инициативу своей фракции для следующего заседания.',target:'actions',button:'Подать инициативу'},
 5:{title:'Участвуйте в парламентском голосовании',body:'Следите за кворумом и голосуйте в соответствии с позицией фракции.',target:'votes',button:'Открыть голосование'},
 6:{title:'Сформируйте управленческое решение',body:'Распределите роли и предложите решение от исполнительной власти.',target:'actions',button:'Подать решение'},
 7:{title:'Определите стратегию кампании',body:'Согласуйте кандидата, позиционирование и политическую стратегию партии.',target:'parties',button:'Открыть партию'},
 8:{title:'Сформируйте Правительство',body:'Определите приоритеты и подготовьте первое управленческое решение.',target:'actions',button:'Подать решение'},
 9:{title:'Подготовьте документ государственной политики',body:'Сформулируйте цель, меры и ожидаемый результат.',target:'documents',button:'Открыть материалы'},
 10:{title:'Проведите законопроект',body:'Подготовьте инициативу и вынесите её на обсуждение и голосование.',target:'actions',button:'Создать законопроект'},
 11:{title:'Согласуйте позицию с Советом Федерации',body:'Учитывайте интересы регионов и федерального центра.',target:'votes',button:'Открыть процедуры'},
 12:{title:'Проверьте конституционность решений',body:'Сопоставьте принятые решения с ограничениями и процедурой.',target:'documents',button:'Открыть материалы'},
 13:{title:'Согласуйте бюджет',body:'Определите приоритеты расходов, доходов и политические компромиссы.',target:'actions',button:'Подать бюджетное решение'},
 14:{title:'Примите решение на муниципальном уровне',body:'Распределите полномочия и подготовьте решение для местного самоуправления.',target:'actions',button:'Подать решение'},
 15:{title:'Отреагируйте на кризис',body:'Следите за общим экраном, договоритесь с командой и предложите антикризисное решение.',target:'actions',button:'Подать решение'},
 16:{title:'Подведите итоги',body:'Зафиксируйте результаты роли, команды и принятых решений.',target:'documents',button:'Открыть итоговые материалы'}
};

export default function DashboardView({g,onNavigate}:{g:ReturnTypeRepublic;onNavigate:(v:'actions'|'parties'|'votes'|'documents')=>void}){
 const {game,me,events,votes,actions,crises,currentStage,setChatOpen,chatOpen,realtimeState}=g;
 if(!game||!me)return null;
 const task=STAGE_ACTIONS[currentStage?.stage_no||game.current_round]||STAGE_ACTIONS[1];
 const openVotes=votes.filter(v=>v.status==='open');
 const myPending=actions.filter(a=>a.author_id===me.user_id&&a.status==='submitted');

 return <div className="studentHome">
  <section className="studentStageHero">
   <div className="studentStageNo">{String(currentStage?.stage_no||game.current_round).padStart(2,'0')}</div>
   <div className="studentStageCopy">
    <small>ТЕКУЩИЙ ЭТАП</small>
    <h1>{currentStage?.title||'Республика Политология'}</h1>
    <p>{currentStage?.summary||'Следуйте текущей задаче и работайте вместе со своей командой.'}</p>
   </div>
   <div className={`studentTurn ${game.turn_open?'open':'paused'}`}><span>{game.turn_open?'● Ход открыт':'Ⅱ Пауза'}</span><small>{realtimeState==='connected'?'Связь с игрой активна':realtimeState==='connecting'?'Подключение…':'Нет realtime-связи'}</small></div>
  </section>

  <section className="studentTask">
   <div className="studentTaskLabel">ВАША ЗАДАЧА СЕЙЧАС</div>
   <h2>{game.turn_open?task.title:'Подождите открытия хода'}</h2>
   <p>{game.turn_open?task.body:'Преподаватель поставил игру на паузу. Используйте это время, чтобы договориться с командой и изучить материалы.'}</p>
   <div className="studentTaskActions">
    <button className="primary bigPrimary" disabled={!game.turn_open} onClick={()=>onNavigate(task.target)}>{task.button} →</button>
    <button className="secondary" onClick={()=>setChatOpen(!chatOpen)}>{chatOpen?'Скрыть связь':'Связаться с командой'}</button>
   </div>
   <div className="studentTaskStatus">
    {openVotes.length>0&&<span>● Открыто голосование: {openVotes[0].title}</span>}
    {myPending.length>0&&<span>⌛ {myPending.length} решений ждут рассмотрения</span>}
    {!openVotes.length&&!myPending.length&&<span>Сейчас дополнительных обязательных действий нет</span>}
   </div>
  </section>

  <section className="studentBelow">
   <article className="surface simpleFeed">
    <div className="surfaceHead"><div><small>ЧТО ИЗМЕНИЛОСЬ</small><h2>События игры</h2></div></div>
    {events.length===0?<div className="emptyState">Новых событий пока нет.</div>:<div className="simpleEventList">{events.slice(0,5).map(e=><div key={e.id} className={`simpleEvent ${e.severity}`}><time>{new Date(e.published_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time><div><b>{e.title}</b><p>{e.body}</p></div></div>)}</div>}
   </article>

   <article className="surface studentProfileCompact">
    <div className="surfaceHead"><div><small>ВАША РОЛЬ</small><h2>{me.role_title||'Участник'}</h2></div></div>
    <dl><div><dt>Фракция</dt><dd>{me.team||'Не назначена'}</dd></div><div><dt>Группа</dt><dd>{me.group_name||'—'}</dd></div><div><dt>Мои решения</dt><dd>{actions.filter(a=>a.author_id===me.user_id).length}</dd></div></dl>
    {crises[0]&&<div className="compactAlert"><small>КРИЗИС</small><b>{crises[0].crisis_type}</b><p>{crises[0].description}</p></div>}
   </article>
  </section>
 </div>;
}