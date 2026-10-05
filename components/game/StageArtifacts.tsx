'use client';
import {useState} from 'react';
import StageDocumentForm from './StageDocumentForm';
import {ArrowUpRight,CheckCircle2,FilePlus2,FileText,Link2,PartyPopper,Vote} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Stage,View} from './types';
import {DOCUMENT_TEMPLATES} from './documentTemplates';
type Task={title:string;help:string;templates:string[];target?:View};
export const STAGE_FORMS:Record<number,Task>={
 1:{title:'Регистрационный пакет партии',help:'Создайте партию, заполните её программу и устав, прикрепите заявление, символику, сведения о пошлине и протокол съезда. Отправьте пакет на проверку Минюсту в разделе «Партии».',templates:[],target:'parties'},
 2:{title:'Правила распределения мандатов',help:'В рабочей форме ниже предложите электоральную формулу. Зарегистрируйте заседание, проверьте состав и зафиксируйте результат голосования в протоколе.',templates:['minutes'],target:'votes'},
 3:{title:'Региональное представительство',help:'Выберите способ распределения регионального ресурса в форме этапа. Зафиксируйте выбранную модель и результат заседания; документ не заменяет настройку распределения.',templates:['minutes'],target:'votes'},
 4:{title:'Организация Государственной Думы',help:'Выдвиньте руководство палаты в форме выборов ниже. После голосования оформите постановление о результатах и составе органов палаты.',templates:['gd_resolution','minutes']},
 5:{title:'Регламент Ghost voting',help:'Сначала согласуйте правила временного отсутствия депутатов, затем используйте форму GV. Зафиксируйте решения в протоколе; доступные мандаты пересчитываются в голосованиях.',templates:['gd_resolution','minutes'],target:'votes'},
 6:{title:'Регистрация кандидата',help:'Подайте кандидатуру и файлы в форме регистрации ниже, укажите программу и основание выдвижения. Следите за ответом комиссии; повторная подача должна устранять конкретные замечания.',templates:['other']},
 7:{title:'Назначение и итоги выборов',help:'Выберите модель выборов в рабочей форме, проведите голосование и зафиксируйте его численные результаты. Полномочия избранного лица назначаются по результатам процедуры.',templates:['sf_resolution','minutes'],target:'votes'},
 8:{title:'Формирование Правительства',help:'Подготовьте кандидатуры в форме этапа и проведите необходимые согласования. Оформляйте назначения после решения соответствующего органа.',templates:['president_decree','gd_resolution'],target:'votes'},
 9:{title:'Комитеты и министерства',help:'Заполните структуру и состав в форме ниже. При необходимости оформите постановление палаты и приказы ведомств; проверьте, что назначенные студенты могут выбрать свою должность.',templates:['gd_resolution','ministry_order']},
 10:{title:'Проект государственной программы',help:'Заполните паспорт, показатели, мероприятия и финансовое обеспечение в форме программы. Создайте её текст в правовом портале и ФЭО. Черновик отобразится здесь сразу после регистрации.',templates:['state_program','financial_economic'],target:'budget'},
 11:{title:'Рассмотрение государственной программы',help:'Откройте заседание Правительства в форме ниже. Приложите программу к повестке, проверьте кворум, проведите рассмотрение и оформите постановление с утверждённым текстом.',templates:['government_resolution','minutes'],target:'votes'},
 12:{title:'Пакет законодательной инициативы',help:'Создайте проект закона, пояснительную записку и перечень затрагиваемых актов. Добавьте ФЭО и заключение Правительства, если они нужны. Досье и чтения доступны внутри документа.',templates:['fz_bill','explanatory_note','affected_acts','financial_economic','government_opinion'],target:'votes'},
 13:{title:'Проект федерального бюджета',help:'Откройте бюджетный калькулятор: проверьте семь групп доходов, распределите расходы по 14 разделам и покройте дефицит. Рассмотрите запросы регионов, сохраните общий расчет и создайте из него проект с числовыми приложениями. Пройдите чтения, Совет Федерации и подпись Президента в правовом портале.',templates:['financial_economic'],target:'budget'},
 14:{title:'Муниципальный проект',help:'Зафиксируйте наблюдаемую местную проблему и доказательства в форме проекта ниже. Подготовьте муниципальный акт с расходами, источником средств, сроком и исполнителями.',templates:['municipal_act','financial_economic'],target:'budget'},
 15:{title:'Правовое реагирование на кризис',help:'Изучите кризис в рабочей форме, определите компетентный орган и пригласите его представителя. Оформите решение того уровня власти, который действует в ситуации.',templates:['president_decree','government_resolution','ministry_order','municipal_act'],target:'events'},
 16:{title:'Итоговый разбор',help:'Заполните аналитический разбор в форме этапа ниже. Сопоставьте документы, голоса, бюджет и последствия; отделите свои предположения от подтверждённых результатов.',templates:[],target:'grades'}
};
export default function StageArtifacts({g,stage,readOnly,onOpenDocument,onCreateDocument,onNavigate,onOpenVotes}:{g:ReturnTypeRepublic;stage:Stage;readOnly?:boolean;onOpenDocument?:(id:string)=>void;onCreateDocument?:(key:string,stageNo:number)=>void;onNavigate?:(view:View)=>void;onOpenVotes:()=>void}){
 const [form,setForm]=useState(''),[saved,setSaved]=useState('');
 const task=STAGE_FORMS[stage.stage_no];if(!task)return null;
 const docs=g.formalDocuments.filter(d=>d.stage_no===stage.stage_no),votes=g.votes.filter(v=>v.stage_no===stage.stage_no);
 const completed=stage.status==='completed';
 const partySync=stage.stage_no===1?g.parties.map(p=>({
  ...p,
  documents:g.partyDocuments.filter(d=>d.party_id===p.id)
 })):[];
 return <section className="stageArtifacts surface"><header><div><small>ФОРМЫ И РЕЗУЛЬТАТЫ · ЭТАП {stage.stage_no}</small><h3>{task.title}</h3></div>{completed&&<span><CheckCircle2 size={18}/> Завершён</span>}</header><p>{task.help}</p>
 {stage.stage_no===1&&<section className="stageProfileSync">
  <div className="stageProfileSyncHead"><div><Link2 size={18}/><span><small>СИНХРОНИЗАЦИЯ</small><b>Данные из раздела «Партии / фракции»</b></span></div>{onNavigate&&<button type="button" onClick={()=>onNavigate('parties')}>Открыть партии <ArrowUpRight size={15}/></button>}</div>
  {partySync.length?<div className="stagePartySyncGrid">{partySync.map(p=><article key={p.id}><div><PartyPopper size={17}/><span><b>{p.name}</b><small>{p.ideology||'Идеология не указана'}</small></span></div><div className="stagePartySyncMeta"><span className={'is-'+p.registration_status}>{p.registration_status==='registered'?'Зарегистрирована':p.registration_status==='submitted'?'На проверке':p.registration_status==='revision'?'Нужна доработка':p.registration_status==='rejected'?'Отклонена':'Черновик'}</span><span>{p.documents.length} док.</span></div></article>)}</div>:<div className="stageProfileSyncEmpty">Партии ещё не созданы. Создайте партию в профильном разделе — она автоматически появится здесь.</div>}
 </section>}
 <div className="stageArtifactActions">{task.templates.map(key=>{const t=DOCUMENT_TEMPLATES.find(x=>x.key===key);return t&&<button type="button" key={key} disabled={readOnly} aria-expanded={form===key} onClick={()=>{setForm(form===key?'':key);setSaved('')}}><FilePlus2 size={18}/><span>{t.title}</span></button>})}{task.target&&onNavigate&&<button type="button" onClick={()=>onNavigate(task.target!)}><ArrowUpRight size={18}/><span>Открыть {({parties:'партии',votes:'голосования',budget:'бюджет',events:'события',grades:'журнал оценок'} as Partial<Record<View,string>>)[task.target]||'раздел'}</span></button>}</div>
 {form&&!readOnly&&<StageDocumentForm key={form} g={g} templateKey={form} stageNo={stage.stage_no} onCancel={()=>setForm('')} onSaved={()=>{setSaved('Черновик сохранён в реестре НПА и связан с этапом.');setForm('')}}/>}
 {saved&&<p className="stageDocumentSaved" role="status">{saved}</p>}
 <div className="stageArtifactResults"><div><b>Документы этапа · {docs.length}</b>{docs.length?docs.map(d=><button key={d.id} type="button" disabled={!onOpenDocument} onClick={()=>onOpenDocument?.(d.id)}><FileText size={18}/><span><strong>{d.title}</strong><small>{d.registry_no} · {d.status_label}</small></span><ArrowUpRight size={16}/></button>):<p>Документов пока нет. После создания в правовом портале они появятся здесь.</p>}</div><div><b>Голосования этапа · {votes.length}</b>{votes.length?votes.map(v=><button type="button" key={v.id} onClick={onOpenVotes}><Vote size={18}/><span><strong>{v.title}</strong><small>{v.status==='open'?'Идёт голосование':(v.result_label||'Завершено')} · За: {v.result_yes??0} · Против: {v.result_no??0} · Воздержались: {v.result_abstain??0}</small></span></button>):<p>Процедурные голосования отображаются после открытия заседания.</p>}</div></div>
 {completed&&<p className="stageArtifactCompletion">Этап завершён {stage.completed_at?new Date(stage.completed_at).toLocaleString('ru-RU'):''}. Результат каждого документа и голосования отражён выше; оценки доступны в журнале.</p>}
 </section>;
}
