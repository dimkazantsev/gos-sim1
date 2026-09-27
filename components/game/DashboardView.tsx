import type {ReturnTypeRepublic} from './viewTypes';

const STAGE_ACTIONS:Record<number,{title:string;body:string;target:'parties'|'votes'|'documents'|'actions'|'stages';button:string}>={
 1:{title:'Завершите учреждение и регистрацию партии',body:'Соберите команду, программу, символику и регистрационный пакет; получите итоговое решение игрового Минюста.',target:'parties',button:'Открыть партию'},
 2:{title:'Выберите архитектуру выборов в Государственную Думу',body:'Предложите тип избирательной системы и формулу распределения мандатов, затем вынесите её на голосование КСРФ.',target:'stages',button:'Открыть этап 2'},
 3:{title:'Определите, как распределяются 89 субъектов',body:'Сравните случайный, пропорциональный и договорной методы и зафиксируйте итог регионального распределения.',target:'stages',button:'Открыть этап 3'},
 4:{title:'Сформируйте руководство Государственной Думы',body:'Проверьте распределение 450 мандатов, выдвигайте кандидатов и проведите выборы Председателя ГД и двух заместителей.',target:'stages',button:'Открыть парламент'},
 5:{title:'Примите режим Ghost voting',body:'ГД должна принять постановление о допустимости Ghost voting; жеребьёвка временно меняет реальный баланс голосов.',target:'stages',button:'Открыть этап 5'},
 6:{title:'Выдвиньте и зарегистрируйте кандидатов в Президенты',body:'Подготовьте кандидатуру и программу, пройдите игровую правовую проверку и исправьте замечания до регистрации.',target:'stages',button:'Открыть выборы Президента'},
 7:{title:'Проведите президентские выборы',body:'Настройте принятую модель большинства, завершите первый тур и при необходимости второй тур, зафиксируйте победителя.',target:'stages',button:'Открыть этап 7'},
 8:{title:'Сформируйте Правительство',body:'Проведите внесение, парламентское утверждение, консультации и окончательные назначения по предусмотренным маршрутам.',target:'stages',button:'Открыть формирование Правительства'},
 9:{title:'Сформируйте комитеты ГД и министерства',body:'Распределите депутатов по пяти комитетам, изберите их председателей и укомплектуйте пять игровых министерств.',target:'stages',button:'Открыть кадровую матрицу'},
 10:{title:'Разработайте государственную программу',body:'Свяжите приоритеты послания Президента с паспортом ГП, тремя направлениями, сроками, показателями и бюджетом.',target:'stages',button:'Открыть лабораторию ГП'},
 11:{title:'Представьте ГП на заседании Правительства',body:'Сформируйте повестку, проведите доклады и обсуждение, а при необходимости — голосование по каждой программе.',target:'stages',button:'Открыть заседание Правительства'},
 12:{title:'Проведите законопроект через Государственную Думу',body:'Работайте с реестром НПА и парламентской повесткой: внесение, комитеты, чтения, голосования и перенос незавершённых вопросов.',target:'stages',button:'Открыть законодательный этап'},
 13:{title:'Сформируйте и проведите федеральный бюджет',body:'Зафиксируйте макросценарий, распределите финансирование принятых ГП и создайте проект федерального бюджета в реестре НПА.',target:'stages',button:'Открыть бюджетную лабораторию'},
 14:{title:'Защитите муниципальный проект',body:'Докажите наблюдаемую проблему, компетенцию местного уровня, предложите решение, бюджет и ожидаемый эффект.',target:'stages',button:'Открыть муниципальный проект'},
 15:{title:'Отреагируйте на кризис',body:'Запрашивайте недостающие сведения, сформируйте решение, правовое основание, ресурсы и публичную коммуникацию до завершения сценария.',target:'stages',button:'Открыть кризисный штаб'},
 16:{title:'Проведите итоговую рефлексию',body:'Восстановите свои решения и причинные цепочки по шести фазам игры, оцените эффективность и предложите конкретные улучшения.',target:'stages',button:'Открыть итоговый разбор'}
};

export default function DashboardView({g,onNavigate}:{g:ReturnTypeRepublic;onNavigate:(v:'actions'|'parties'|'votes'|'documents'|'stages')=>void}){
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