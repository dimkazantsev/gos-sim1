import type {ReturnTypeRepublic} from './viewTypes';

const STAGE_ACTIONS:Record<number,{title:string;body:string;target:'parties'|'votes'|'documents'|'actions';button:string}>={
 1:{title:'Соберите политическую партию',body:'Определите идеологию, распределите роли, выберите председателя и договоритесь о внутренней организации.',target:'parties',button:'Перейти к партиям'},
 2:{title:'Определите избирательную систему',body:'Обсудите модель выборов и подготовьте позицию вашей фракции к общему решению.',target:'votes',button:'Перейти к голосованию'},
 3:{title:'Сформируйте политическую карту',body:'Следите за поддержкой, регионами и ресурсами своей партии. Согласуйте стратегию с фракцией.',target:'parties',button:'Открыть политическую карту'},
 4:{title:'Подготовьтесь к парламентской работе',body:'Зафиксируйте позиции фракции и сформулируйте предложения для следующего заседания.',target:'actions',button:'Подать инициативу'},
 5:{title:'Работайте в Государственной Думе',body:'Участвуйте в голосованиях, соблюдайте кворум и следите за возможным ghost voting.',target:'votes',button:'Открыть голосования'},
 6:{title:'Сформируйте исполнительную власть',body:'Распределите государственные роли и подготовьте управленческие решения.',target:'actions',button:'Подать решение'},
 7:{title:'Участвуйте в президентской кампании',body:'Согласуйте позицию партии, кандидата и политическую стратегию.',target:'parties',button:'Открыть партии'},
 8:{title:'Сформируйте Правительство',body:'Определите приоритеты исполнительной власти и подготовьте первые решения.',target:'actions',button:'Подать решение'},
 9:{title:'Разработайте государственную политику',body:'Подготовьте документ или управленческое решение по текущему направлению.',target:'documents',button:'Открыть документы'},
 10:{title:'Пройдите законотворческий цикл',body:'Подготовьте инициативу, обсудите её и вынесите на голосование.',target:'actions',button:'Создать законопроект'},
 11:{title:'Работайте с Советом Федерации',body:'Согласуйте позиции субъектов и федерального центра.',target:'votes',button:'Открыть процедуры'},
 12:{title:'Проверьте конституционность решений',body:'Сопоставьте принятые решения с конституционными ограничениями и процедурой.',target:'documents',button:'Открыть документы'},
 13:{title:'Сформируйте федеральный бюджет',body:'Согласуйте расходы, доходы и политические приоритеты вашей команды.',target:'actions',button:'Подать бюджетное решение'},
 14:{title:'Организуйте местное самоуправление',body:'Распределите полномочия и подготовьте решения для муниципального уровня.',target:'actions',button:'Подать решение'},
 15:{title:'Реагируйте на кризис',body:'Следите за общим экраном, координируйтесь с фракцией и быстро подавайте антикризисные решения.',target:'actions',button:'Подать антикризисное решение'},
 16:{title:'Подведите итоги',body:'Оцените результаты своей роли, команды и принятых решений. Зафиксируйте итоговые документы.',target:'documents',button:'Открыть итоговые документы'}
};

export default function DashboardView({g,onNavigate}:{g:ReturnTypeRepublic;onNavigate:(v:'actions'|'parties'|'votes'|'documents')=>void}){
 const {game,me,metrics,events,members,parties,votes,actions,crises,currentStage,averageVsn,setChatOpen,chatOpen,realtimeState}=g;
 if(!game||!me)return null;
 const task=STAGE_ACTIONS[currentStage?.stage_no||game.current_round]||STAGE_ACTIONS[1];
 const mySubmitted=actions.filter(a=>a.author_id===me.user_id&&a.status==='submitted').length;
 const openVotes=votes.filter(v=>v.status==='open').length;
 return <>
  <section className="dashHero"><div><small>НАЦИОНАЛЬНЫЙ СИТУАЦИОННЫЙ ЦЕНТР</small><h1>{currentStage?.title||'Республика Политология'}</h1><p>{currentStage?.summary||'Многопользовательская симуляция государственного и политико-административного управления.'}</p><div className="heroButtons"><button className="primary" disabled={!game.turn_open} onClick={()=>onNavigate('actions')}>Инициировать решение</button><button className="secondary" onClick={()=>setChatOpen(!chatOpen)}>{chatOpen?'Скрыть связь':'Открыть связь'}</button></div></div><div className="heroData"><div><span>Участники</span><b>{members.length}</b></div><div><span>Партии</span><b>{parties.length}</b></div><div><span>Открытые голосования</span><b>{openVotes}</b></div><div><span>Мой ВСН</span><b>{averageVsn?averageVsn.toFixed(1):'—'}</b></div></div></section>

  {!g.teacher&&<section className="nextTaskCard"><div className="nextTaskIcon">{game.turn_open?'→':'Ⅱ'}</div><div><small>ЧТО ДЕЛАТЬ СЕЙЧАС</small><h2>{game.turn_open?task.title:'Ход временно закрыт преподавателем'}</h2><p>{game.turn_open?task.body:'Изучите текущий этап, согласуйте позицию с командой и дождитесь открытия хода.'}</p><div className="nextTaskMeta"><span>{mySubmitted?mySubmitted+' решений ждут рассмотрения':'Нет решений на рассмотрении'}</span>{openVotes>0&&<span>{openVotes} открытых голосований</span>}<span className={`syncBadge ${realtimeState}`}>{realtimeState==='connected'?'● Связь в реальном времени':realtimeState==='connecting'?'○ Подключение…':'! Связь прервана'}</span></div></div><button className="primary" disabled={!game.turn_open} onClick={()=>onNavigate(task.target)}>{task.button}</button></section>}

  <section className="metricDeck">{metrics.map(m=><article key={m.id}><span>{m.label}</span><strong>{m.value}{m.unit||''}</strong><div><i style={{width:`${Math.min(100,Math.max(5,Number(m.value)))}%`}}/></div></article>)}</section>
  <section className="dashGrid"><article className="surface"><div className="surfaceHead"><div><small>ОПЕРАТИВНАЯ ЛЕНТА</small><h2>События государства</h2></div><b>{events.length}</b></div><div className="eventStream">{events.length===0?<div className="emptyState">Событий пока нет.</div>:events.map(e=><div className={`streamItem ${e.severity}`} key={e.id}><div className="streamMeta"><time>{new Date(e.published_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><span>{e.category}</span></div><h3>{e.title}</h3><p>{e.body}</p></div>)}</div></article>
  <article className="surface"><div className="surfaceHead"><div><small>МОЯ ПОЗИЦИЯ</small><h2>Игровой профиль</h2></div></div><div className="profileStats"><div><span>Роль</span><b>{me.role_title||me.kind}</b></div><div><span>Фракция</span><b>{me.team||'—'}</b></div><div><span>Решений</span><b>{actions.filter(a=>a.author_id===me.user_id).length}</b></div><div><span>Этап</span><b>{currentStage?.stage_no||game.current_round}/16</b></div></div>{crises[0]&&<div className="alertCard"><small>ПОСЛЕДНИЙ КРИЗИС</small><b>{crises[0].crisis_type}</b><p>{crises[0].description}</p></div>}</article></section>
 </>;
}