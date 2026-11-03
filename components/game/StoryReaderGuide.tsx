'use client';
import type {View} from './types';
import styles from './StoryReaderGuide.module.css';

type Guide={mode:'information'|'existing_procedure';audience:string;action:string;evidence:string;stage_number:number};
function valid(x:unknown):x is Guide {
 if(!x||typeof x!=='object'||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return (v.mode==='information'||v.mode==='existing_procedure')
  &&typeof v.audience==='string'&&typeof v.action==='string'
  &&typeof v.evidence==='string'&&typeof v.stage_number==='number';
}
/** The published post context is the only source: no private drafts or future endings. */
export default function StoryReaderGuide({raw,episodeNo,stageNo,onNavigate}:{
 raw:unknown;episodeNo:number;stageNo:number;
 onNavigate:(view:View,target?:{stageNo?:number})=>void;
}){
 if(!valid(raw)||episodeNo<1||episodeNo>24||raw.stage_number!==stageNo||stageNo<4||stageNo>14)return null;
 const informative=raw.mode==='information';
 const route:View=stageNo===11?'votes':stageNo===13?'budget':stageNo===12?'documents':'stages';
 return <section className={styles.guide} aria-label="Сюжетный маршрут">
  <div className={styles.head}><strong>{informative?'Информационный выпуск':'Как участвовать'}</strong><small>Этап {stageNo}</small></div>
  <p><b>Кому адресовано:</b> {raw.audience}</p>
  <p><b>{informative?'Что нужно знать:':'Возможные действия:'}</b> {raw.action}</p>
  <p><b>Что проверять:</b> {raw.evidence}</p>
  {/Д-\d{2}/.test(raw.evidence)&&<p className={styles.note}>Оригиналы сюжетного архива Д-01–Д-08 не прикрепляются автоматически и требуют отдельной публикации.</p>}
  {informative
   ?<p className={styles.note}>Обязательных сюжетных действий или отдельного голосования здесь нет.</p>
   :<div className={styles.actions}>
     <p className={styles.note}>Действовать можно только в пределах своей действующей должности, по правилам ГОС.ID.</p>
     <button type="button" onClick={()=>route==='stages'?onNavigate('stages',{stageNo}):onNavigate(route)}>
       {stageNo===11?'Перейти к голосованиям':stageNo===13?'Открыть бюджет':stageNo===12?'Открыть реестр НПА':'Открыть этап '+stageNo}
     </button>
     {route!=='stages'&&<button type="button" onClick={()=>onNavigate('stages',{stageNo})}>Правила этапа {stageNo}</button>}
    </div>}
 </section>;
}
