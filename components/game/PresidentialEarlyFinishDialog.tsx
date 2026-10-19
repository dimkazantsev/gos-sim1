'use client';
import {AlertTriangle,X} from 'lucide-react';
import {useDialog} from '../ui/useDialog';

export default function PresidentialEarlyFinishDialog({round,busy,onCancel,onConfirm}:{
 round:1|2;busy:boolean;onCancel:()=>void;onConfirm:()=>void;
}){
 const ref=useDialog(true,()=>{if(!busy)onCancel()});
 return <div className="cecEarlyBackdrop" onMouseDown={e=>{if(!busy&&e.target===e.currentTarget)onCancel()}}>
  <section ref={ref} className="cecEarlyDialog" role="dialog" aria-modal="true"
    aria-labelledby="cecEarlyTitle" aria-describedby="cecEarlyText" tabIndex={-1}>
   <div className="cecEarlyHeading">
    <span className="cecEarlyIcon" aria-hidden="true"><AlertTriangle size={23}/></span>
    <div><small>ЦИК РФ · Подтверждение</small><h3 id="cecEarlyTitle">Досрочное завершение {round===1?'первого':'второго'} тура</h3></div>
    <button type="button" className="cecEarlyClose" aria-label="Закрыть окно" disabled={busy} onClick={onCancel}><X size={20}/></button>
   </div>
   <p id="cecEarlyText">Вы уверены, что хотите закончить выборы ранее?</p>
   <p className="cecEarlyExplanation">Результат будет рассчитан по действующим правилам. После фиксации итога тура изменить оценки и голоса преподавателей за этот тур нельзя. Если для определения победителя потребуется второй тур, он будет назначен по утверждённой избирательной системе.</p>
   <div className="cecEarlyActions">
    <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Нет, вернуться</button>
    <button type="button" className="primary" disabled={busy} onClick={onConfirm}>{busy?'Выполняется расчёт…':'Да, зафиксировать итог'}</button>
   </div>
  </section>
 </div>;
}
