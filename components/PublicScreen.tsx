'use client';
import {useRepublicGame} from './game/useRepublicGame';

function fmt(seconds:number){
 const m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
export default function PublicScreen({gameId}:{gameId:string}){
 const g=useRepublicGame(gameId);
 const {game,me,currentStage,metrics,events,votes,parties,crises,ballots,secondsLeft,loading,error,tally,quorum}=g;
 if(loading||!game||!me)return <main className="publicLoading"><div className="spinner"/><b>{error||'Подключение общего экрана…'}</b></main>;
 const vote=votes.find(v=>v.status==='open');
 const score=vote?tally(vote):null;
 const q=vote?quorum(vote):null;
 const latest=events[0];
 return <main className="publicScreen">
  <header className="publicTop">
   <div className="publicBrand"><span>GS</span><div><b>GOS//SIM</b><small>ОБЩИЙ ЭКРАН АУДИТОРИИ</small></div></div>
   <div className="publicGame"><b>{game.title}</b><span>Этап {currentStage?.stage_no||game.current_round} из 16</span></div>
   <div className="publicClock"><span className={game.turn_open?'publicLive on':'publicLive'}>● {game.turn_open?'ХОД ОТКРЫТ':'ПАУЗА'}</span><b>{game.turn_open&&game.turn_ends_at?fmt(secondsLeft):'—'}</b><button onClick={()=>document.documentElement.requestFullscreen?.()}>На весь экран</button></div>
  </header>

  <section className="publicStage">
   <div><small>СЕЙЧАС ПРОИСХОДИТ</small><h1>{currentStage?.title||'Республика Политология'}</h1><p>{currentStage?.summary}</p></div>
   <span className="stageNumber">{String(currentStage?.stage_no||game.current_round).padStart(2,'0')}</span>
  </section>

  <section className="publicMetrics">
   {metrics.map(m=><article key={m.id}><span>{m.label}</span><b>{m.value}{m.unit||''}</b><div><i style={{width:`${Math.min(100,Math.max(3,Number(m.value)))}%`}}/></div></article>)}
  </section>

  <section className="publicGrid">
   <article className="publicMainCard">
    <small>{latest?'ПОСЛЕДНЕЕ СОБЫТИЕ':'ИНФОРМАЦИОННЫЙ ЦЕНТР'}</small>
    {latest?<><div className={`publicEventType ${latest.severity}`}>{latest.category}</div><h2>{latest.title}</h2><p>{latest.body}</p><time>{new Date(latest.published_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time></>:<><h2>Игра началась</h2><p>Новые события преподавателя будут появляться здесь автоматически.</p></>}
   </article>

   <article className="publicVoteCard">
    <small>ГОЛОСОВАНИЕ</small>
    {vote&&score&&q?<><h2>{vote.title}</h2>{vote.body&&<p>{vote.body}</p>}<div className="publicQuorum"><span>Кворум</span><b className={q.met?'ok':'wait'}>{q.cast}/{q.needed}</b></div><div className="publicVoteScore"><div><b>{score.yes}</b><span>ЗА</span></div><div className="publicVoteBar"><i style={{width:`${score.total?score.yes/score.total*100:50}%`}}/></div><div><b>{score.no}</b><span>ПРОТИВ</span></div></div></>:<div className="publicEmpty">Открытого голосования сейчас нет.</div>}
   </article>
  </section>

  <section className="publicBottomGrid">
   <article className="publicParties"><div className="publicSectionHead"><small>ПОЛИТИЧЕСКАЯ КАРТА</small><b>{parties.length} партий</b></div><div>{parties.slice(0,6).map(p=><div className="publicParty" key={p.id}><span style={{background:p.color}}/><b>{p.name}</b><em>{p.support}%</em><small>{p.mandates} манд.</small></div>)}{parties.length===0&&<div className="publicEmpty">Партии ещё не сформированы.</div>}</div></article>
   <article className="publicTimeline"><div className="publicSectionHead"><small>ХРОНИКА</small><b>Последние события</b></div><div>{events.slice(0,5).map(e=><div key={e.id}><time>{new Date(e.published_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time><span>{e.title}</span></div>)}{events.length===0&&<div className="publicEmpty">Событий пока нет.</div>}</div></article>
   <article className={crises[0]?'publicCrisis active':'publicCrisis'}><div className="publicSectionHead"><small>КРИЗИСНЫЙ КОНТУР</small><b>{crises[0]?'Активное последствие':'Стабильно'}</b></div>{crises[0]?<><h3>{crises[0].crisis_type}</h3><p>{crises[0].description}</p></>:<div className="publicEmpty">Новых кризисных событий нет.</div>}</article>
  </section>
 </main>;
}
