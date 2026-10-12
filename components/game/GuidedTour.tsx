'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUpRight,Compass,X} from 'lucide-react';
import type {View} from './types';
import styles from './GuidedTour.module.css';

export type TourTarget=View|'chat';
export type TourStep={target:TourTarget;title:string;body:string;hint:string};
const PARTICIPANT_STEPS:TourStep[]=[
 {target:'dashboard',title:'Обзор Республики',body:'Здесь собраны состояние Республики, текущий этап, ключевые показатели и последние изменения. Начинайте отсюда, чтобы понять, что происходит в государстве и какие вопросы требуют внимания.',hint:'Нажмите «Обзор игры».'},
 {target:'stages',title:'Этапы и задачи',body:'Это последовательность работы органов власти. Откройте действующий этап, изучите его задачи, сроки и доступные действия. Из этого раздела можно перейти к подготовке документов, заседаниям и обсуждениям.',hint:'Откройте «Этапы и задачи».'},
 {target:'actions',title:'Политический процесс',body:'Здесь публикуются инициативы, заявления и сообщения участников. Следите за действиями государственных органов, обсуждайте предложения и переходите к связанным нормативным актам и голосованиям.',hint:'Откройте «Политический процесс».'},
 {target:'parties',title:'Партии и фракции',body:'В этом разделе отражаются политические объединения, их состав и представительство. Здесь вы сможете работать с фракцией и, если у вас есть соответствующие полномочия, участвовать в партийных процедурах.',hint:'Нажмите «Моя партия» или «Партии».'},
 {target:'documents',title:'Реестр нормативных актов',body:'Проекты законов и другие официальные документы проходят здесь установленную процедуру: подготовку, редакции, рассмотрение и опубликование. Статус документа имеет значение — проект ещё не является действующим актом.',hint:'Откройте «Реестр НПА».'},
 {target:'votes',title:'Голосования и заседания',body:'В этом разделе находятся доступные голосования и регистрация на заседания. Право голосовать зависит от вашей должности, фракции и полномочий. Перед выбором проверьте предмет голосования и связанные документы.',hint:'Нажмите «Голосования».'},
 {target:'budget',title:'Бюджет и государственные финансы',body:'Здесь рассчитываются доходы и расходы, региональные трансферты, дефицит и меры его покрытия. Решения изменяют экономические показатели, а законодательные поправки должны пройти предусмотренную процедуру.',hint:'Откройте «Бюджет».'},
 {target:'events',title:'События и ситуации',body:'К вам могут поступать управленческие задачи, кризисы и межведомственные обращения. Изучайте обстоятельства, проверяйте компетенцию своего органа и выбирайте обоснованное действие: оно может повлиять на показатели Республики.',hint:'Откройте «События и ситуации».'},
 {target:'grades',title:'Оценки и разбор действий',body:'Здесь отражаются результаты по этапам и объяснения оценивания. Правовой компонент ВСН учитывает решения ситуаций, действия в игре и ответы на «Блиц». Утверждённую итоговую оценку фиксирует преподаватель.',hint:'Нажмите «Оценки и разбор».'},
 {target:'chat',title:'Чат и совместная работа',body:'Чат нужен для обсуждения решений, согласования действий и обмена материалами. Выбирайте нужный канал, следите за упоминаниями и непрочитанными сообщениями. Сообщение в чате само по себе не заменяет официальную процедуру.',hint:'Нажмите настоящую кнопку «Чат».'},
 {target:'profile',title:'Личный профиль',body:'Последний шаг — ваш профиль. Здесь находятся личные сведения, игровая должность, подпись и настройки доступа, а рядом с архивом комиксов будет кнопка «Обучение». При первом входе заполните обязательные поля и нажмите «Закончить настройку». При повторном прохождении уже заполненный профиль не изменится.',hint:'Откройте «Мой профиль» — это завершит экскурсию.'}
];
const TEACHER_STEP:TourStep={target:'teacher',title:'Управление Республикой',body:'Панель преподавателя предназначена для контроля этапов, игровых процедур, действий участников и оценивания. Доступ к ней есть только у пользователей с соответствующими правами; в режиме просмотра студента преподавательские операции блокируются.',hint:'Откройте «Управление».'};
export function getTourSteps(teacher:boolean):TourStep[]{
 return teacher?[...PARTICIPANT_STEPS.slice(0,-1),TEACHER_STEP,PARTICIPANT_STEPS[PARTICIPANT_STEPS.length-1]]:PARTICIPANT_STEPS;
}
type Rect={left:number;top:number;width:number;height:number;right:number;bottom:number};
function visible(button:HTMLElement){const box=button.getBoundingClientRect(),style=getComputedStyle(button);return style.display!=='none'&&style.visibility!=='hidden'&&box.width>0&&box.height>0}
function targetElement(target:TourTarget){
 const mobile=window.matchMedia('(max-width:1099px)').matches;
 const selectors=target==='chat'?(mobile?['.mobileDockChat','.topChatButton']:['.topChatButton','.mobileDockChat']):mobile?
  [`.mobileDock [data-tour-view="${target}"]`,`.focusNav [data-tour-view="${target}"]`]:
  [`.focusNav [data-tour-view="${target}"]`,`.mobileDock [data-tour-view="${target}"]`];
 for(const selector of selectors){const found=[...document.querySelectorAll<HTMLElement>(selector)].find(visible);if(found)return found}
 return null;
}
export default function GuidedTour({step,index,total,onSkip,onFallback}:{step:TourStep;index:number;total:number;onSkip:()=>void;onFallback:(target:TourTarget)=>void}){
 const [rect,setRect]=useState<Rect|null>(null);
 const cardRef=useRef<HTMLDivElement>(null);
 const [cardSize,setCardSize]=useState({width:400,height:240});
 useEffect(()=>{
  let timer:number|undefined,frame:number|undefined;
  function update(){const el=targetElement(step.target);if(!el){setRect(null);return}const r=el.getBoundingClientRect();setRect({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height})}
  const el=targetElement(step.target);
  el?.scrollIntoView({block:'nearest',inline:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  frame=requestAnimationFrame(update);
  timer=window.setTimeout(update,420);
  window.addEventListener('resize',update);
  window.addEventListener('scroll',update,true);
  return()=>{if(frame)cancelAnimationFrame(frame);if(timer)clearTimeout(timer);window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)};
 },[step.target,index]);
 useEffect(()=>{
  const el=cardRef.current;if(!el)return;
  const observer=new ResizeObserver(()=>setCardSize({width:el.offsetWidth,height:el.offsetHeight}));
  observer.observe(el);
  return()=>observer.disconnect();
 },[index]);
 useEffect(()=>{
  const handle=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onSkip()}};
  window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);
 },[onSkip]);
 if(typeof document==='undefined')return null;
 const w=window.innerWidth,h=window.innerHeight,p=9;
 const spotlight=rect?{left:Math.max(0,rect.left-p),top:Math.max(0,rect.top-p),right:Math.min(w,rect.right+p),bottom:Math.min(h,rect.bottom+p)}:null;
 const cardWidth=Math.min(420,w-24);
 const below=rect?rect.bottom+cardSize.height+24<h: true;
 const cardTop=rect?Math.max(12,Math.min(h-cardSize.height-12,below?rect.bottom+24:rect.top-cardSize.height-24)):Math.max(12,(h-cardSize.height)/2);
 const cardLeft=rect?Math.max(12,Math.min(w-cardWidth-12,rect.left+rect.width/2-cardWidth/2)):Math.max(12,(w-cardWidth)/2);
 const startX=cardLeft+cardWidth/2,startY=below?cardTop:cardTop+cardSize.height;
 const endX=rect?Math.min(w,Math.max(0,rect.left+rect.width/2)):startX;
 const endY=rect?(below?rect.bottom+5:rect.top-5):startY;
 return createPortal(<div className={styles.root} aria-label="Обучение навигации">
  {spotlight?<div className={styles.shades} aria-hidden="true">
   <div style={{left:0,top:0,width:w,height:spotlight.top}}/>
   <div style={{left:0,top:spotlight.bottom,width:w,height:h-spotlight.bottom}}/>
   <div style={{left:0,top:spotlight.top,width:spotlight.left,height:spotlight.bottom-spotlight.top}}/>
   <div style={{left:spotlight.right,top:spotlight.top,width:w-spotlight.right,height:spotlight.bottom-spotlight.top}}/>
  </div>:<div className={styles.fullShade}/>}
  {spotlight&&<div className={styles.ring} aria-hidden="true" style={{left:spotlight.left,top:spotlight.top,width:spotlight.right-spotlight.left,height:spotlight.bottom-spotlight.top}}/>}
  {rect&&<svg className={styles.connector} aria-hidden="true" width={w} height={h} viewBox={`0 0 ${w} ${h}`}><defs><marker id="tour-arrowhead" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M1 1 L7 4.5 L1 8" fill="none" stroke="#82d5ff" strokeWidth="1.8" strokeLinecap="round"/></marker></defs><path d={`M ${startX} ${startY} Q ${(startX+endX)/2} ${(startY+endY)/2} ${endX} ${endY}`} fill="none" stroke="#82d5ff" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 5" markerEnd="url(#tour-arrowhead)"/></svg>}
  <div ref={cardRef} className={styles.card} style={{left:cardLeft,top:cardTop,width:cardWidth}} role="status" aria-live="polite">
   <div className={styles.header}><span><Compass size={16} aria-hidden="true"/> ГОС.ID · ОБУЧЕНИЕ</span><button type="button" onClick={onSkip} aria-label="Пропустить обучение" title="Пропустить обучение"><X size={19}/></button></div>
   <div className={styles.progressLabel}>Шаг {index+1} из {total}</div>
   <div className={styles.progress}><span style={{width:`${(index+1)/total*100}%`}}/></div>
   <h2>{step.title}</h2><p>{step.body}</p>
   <div className={styles.action}><ArrowUpRight size={18} aria-hidden="true"/><strong>{step.hint}</strong></div>
   {!rect&&<button type="button" className={styles.fallback} onClick={()=>onFallback(step.target)}>Открыть указанный раздел</button>}
   <button type="button" className={styles.skip} onClick={onSkip}>Пропустить экскурсию</button>
  </div>
 </div>,document.body);
}
