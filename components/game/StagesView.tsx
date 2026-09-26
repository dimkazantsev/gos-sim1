import type {ReturnTypeRepublic} from './viewTypes';
import {formatDeadline,stageIcon} from './constants';

export default function StagesView({g}:{g:ReturnTypeRepublic}){
 const {stages,teacher,nextStage,openStage,setStageDeadline}=g;
 return <><section className="pageHeader"><div><small>АРХИТЕКТУРА ИГРЫ</small><h1>16 этапов «Республики Политология»</h1><p>Полный цикл: от учредительных съездов партий до кризисного управления и итоговой рефлексии.</p></div>{teacher&&<button className="primary" onClick={nextStage}>Открыть следующий этап</button>}</section>
 <div className="stageTimeline">{stages.map(s=><article className={`stageCard ${s.status}`} key={s.id}><div className="stageNo"><i>{stageIcon(s.stage_no)}</i><span>{String(s.stage_no).padStart(2,'0')}</span></div><div><small>{s.mode}</small><h3>{s.title}</h3><p>{s.summary}</p><div className="stageMeta"><span className={`statusTag ${s.status}`}>{s.status==='open'?'Сейчас':s.status==='completed'?'Завершён':'Закрыт'}</span>{s.deadline&&<span className="deadlineTag">до {formatDeadline(s.deadline)}</span>}{teacher&&s.status!=='open'&&<button onClick={()=>openStage(s.stage_no)}>Открыть</button>}{teacher&&<label className="deadlineControl">Дедлайн<input type="datetime-local" onChange={e=>void setStageDeadline(s.id,e.target.value)}/></label>}</div></div></article>)}</div></>
}