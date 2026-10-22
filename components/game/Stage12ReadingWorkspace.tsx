'use client';

import {useState} from 'react';
import {ArrowRight,Check,FileText,MessagesSquare,Vote} from 'lucide-react';
import LegislativeSessionLab from './LegislativeSessionLab';
import BillAmendmentsPanel from './BillAmendmentsPanel';
import BillSubjectReview from './BillSubjectReview';
import type {ReturnTypeRepublic} from './viewTypes';
import styles from './Stage12ReadingWorkspace.module.css';

export type Reading=1|2|3;
export function billReading(status:string):Reading{
 if(['amendments','reading2'].includes(status))return 2;
 if(['reading3','sf','president','published','veto','conciliation','override'].includes(status))return 3;
 return 1;
}
const tabs=[
 {id:1 as const,title:'Подготовка и первое чтение',detail:'От инициативы до решения по концепции'},
 {id:2 as const,title:'Второе чтение и поправки',detail:'Предложения, обсуждение и голосования'},
 {id:3 as const,title:'Третье чтение',detail:'Принятие закона и опубликование'}
];

export default function Stage12ReadingWorkspace({g,readOnly,onOpenVotes,onOpenDocument,onPrepare}:{
 g:ReturnTypeRepublic;readOnly:boolean;onOpenVotes:(id?:string)=>void;
 onOpenDocument?:(id:string)=>void;onPrepare:()=>void;
}){
 const [reading,setReading]=useState<Reading>(1),[selectedBill,setSelectedBill]=useState('');
 const bills=g.formalDocuments.filter(d=>d.stage_no===12&&d.workflow_key==='bill');
 const second=bills.filter(d=>billReading(d.status_code)===2);
 const amendmentBill=second.find(d=>d.id===selectedBill)||second[0];
 const firstReady=bills.filter(d=>['reading1','amendments','reading2','reading3','sf','president','published'].includes(d.status_code)).length;
 const preparation=[
  {title:'Подготовить пакет',body:'Текст законопроекта, пояснительная записка и обязательные приложения.',done:bills.length>0},
  {title:'Внести в Государственную Думу',body:'Регистрация пакета и направление в профильный комитет.',done:bills.length>0&&bills.every(d=>!['draft','revision'].includes(d.status_code))},
  {title:'Комитет и отзывы субъектов',body:'Заключение комитета, отзывы, предложения и замечания в досье.',done:bills.length>0&&bills.every(d=>['council','reading1','amendments','reading2','reading3','sf','president','published'].includes(d.status_code))},
  {title:'Передать на первое чтение',body:'Совет ГД передаёт подготовленные пакеты. Повестка формируется автоматически.',done:bills.length>0&&firstReady===bills.length}
 ];
 return <div className={styles.workspace}>
  <header className={styles.heading}><h2>Законодательный процесс</h2><p>Каждый законопроект проходит подготовку и чтения. Досье, отзывы и результаты сопровождают его на всём пути.</p></header>
  <div role="tablist" aria-label="Чтения законопроектов" className={styles.tabs}>
   {tabs.map((tab,index)=><button key={tab.id} type="button" role="tab" id={'reading-tab-'+tab.id} aria-selected={reading===tab.id} aria-controls={'reading-panel-'+tab.id} tabIndex={reading===tab.id?0:-1}
    onClick={()=>setReading(tab.id)} onKeyDown={event=>{const delta=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;if(delta||event.key==='Home'||event.key==='End'){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(index+delta+3)%3;setReading(tabs[next].id);document.getElementById('reading-tab-'+tabs[next].id)?.focus();}}}>
    <span className={styles.tabNumber}>{tab.id}</span><span><strong>{tab.title}</strong><small>{tab.detail}</small></span>
   </button>)}
  </div>
  <section role="tabpanel" id={'reading-panel-'+reading} aria-labelledby={'reading-tab-'+reading} className={styles.panel}>
   {reading===1&&<section className={styles.preparation} aria-label="Подготовка к первому чтению">
    <div className={styles.sectionHeading}><div><h3>До открытия заседания</h3><p>Заседание ждёт готовности всех законопроектов повестки.</p></div><button type="button" className="secondary" onClick={onPrepare}><FileText size={17}/>Подготовить документы</button></div>
    <ol className={styles.steps}>{preparation.map((step,index)=><li key={step.title} data-complete={step.done}><span>{step.done?<Check size={17}/>:index+1}</span><div><b>{step.title}</b><p>{step.body}</p></div></li>)}</ol>
   </section>}
   {reading===2&&<section className={styles.preparation} aria-label="Подготовка ко второму чтению">
    <div className={styles.sectionHeading}><div><h3>Сначала — поправки к законопроекту</h3><p>После принятия в первом чтении субъекты инициативы вносят поправки. Комитет готовит таблицу и заключение, Совет ГД назначает второе чтение.</p></div></div>
    <ol className={styles.compactSteps}><li>Внести поправки</li><li>Подготовить таблицу</li><li>Обсудить на заседании</li><li>Проголосовать по поправкам</li></ol>
    {second.length>0?<><label className={styles.billSelect}>Законопроект для работы с поправками<select value={amendmentBill?.id||''} onChange={event=>setSelectedBill(event.target.value)}>{second.map(d=><option key={d.id} value={d.id}>{d.registry_no} · {d.title}</option>)}</select></label>
     {amendmentBill&&<><div className={styles.actions}>{onOpenDocument&&<button type="button" className="secondary" onClick={()=>onOpenDocument(amendmentBill.id)}>Досье, отзывы и передача ко II чтению <ArrowRight size={16}/></button>}</div><BillAmendmentsPanel key={amendmentBill.id} g={g} document={amendmentBill} readOnly={readOnly} onOpenVotes={onOpenVotes}/></>}
    </>:<p className={styles.waiting}>Поправки откроются после принятия законопроекта в первом чтении. Подготовленные материалы и решения сохранятся в его досье.</p>}
   </section>}
   {reading===3&&<section className={styles.preparation} aria-label="Принятие и опубликование закона">
    <div className={styles.sectionHeading}><div><h3>Окончательный текст и принятие закона</h3><p>Комитет готовит окончательную редакцию. В третьем чтении поправки не вносятся: после доклада и выступлений по мотивам голосования закон голосуется в целом.</p></div></div>
    <ol className={styles.compactSteps}><li>III чтение в ГД</li><li>Совет Федерации</li><li>Подпись Президента</li><li>Опубликование</li></ol>
    <p className={styles.help}>В игре Совет Федерации одобряет закон автоматически. Президент может подписать или отклонить его; решение и дальнейший маршрут фиксируются в НПА.</p>
   </section>}
   <aside className={styles.reviews}><MessagesSquare size={20}/><div><b>Отзывы субъектов — в досье законопроекта</b><p>Отзывы, заключения и замечания доступны при подготовке и между чтениями. Действующий субъект инициативы может направить позицию по законопроекту; она сохранится в его сопровождении.</p><BillSubjectReview key={(g.game?.id||'')+':'+g.me?.user_id} g={g} readOnly={readOnly} onOpenDocument={onOpenDocument}/></div></aside>
   <LegislativeSessionLab g={g} reading={reading} readOnly={readOnly} onOpenVotes={onOpenVotes} onOpenDocument={onOpenDocument}/>
   <footer className={styles.help}><Vote size={17}/><span>Результаты голосований определяют дальнейшее движение: следующее чтение, предусмотренное правилами принятие закона или отклонение. Переходы доступны в связанном НПА.</span></footer>
  </section>
 </div>;
}
