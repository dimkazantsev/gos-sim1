import type {ReturnTypeRepublic} from './viewTypes';
import {STAGE_ACTIONS} from './stageActions';

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