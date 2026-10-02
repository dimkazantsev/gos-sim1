'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,BookOpen,ChevronDown,Pause,Play,X} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import illustrations from '@/data/republic-illustrations.json';
import ComicSoundButton from './ComicSoundButton';
type Chapter={id:string;stage_no:number;kind:'completed'|'preview';title:string;body:string;snapshot:{documents?:number;votes?:number};created_at:string};
type Page={id:string;artKey:string;kicker:string;title:string;body:string;caption:string;chapter?:Chapter};
type Artwork={src:string;srcSet:string;width:number;height:number};
const PROLOGUE:Page[]=[
 {id:'prologue-01',artKey:'prologue-01',kicker:'Пролог · После бури',title:'Республика после бури',body:'Предприятиям нужны заказы, городу — ремонт, а людям — понятные решения. Денег и времени меньше, чем задач. Восстановление зависит от того, как вы распределите ресурсы и сможете ли объяснить свой выбор гражданам.',caption:'У каждой проблемы есть участники, ресурсы и последствия.'},
 {id:'prologue-02',artKey:'prologue-02',kicker:'Пролог · Цена обещания',title:'На всё сразу не хватит',body:'Новая школа, больница и водопровод нужны одновременно. Перед обещанием сравните доходы и расходы в бюджете, подготовьте документ и пройдите его процедуру. Принятое решение меняет общую ситуацию для всех участников.',caption:'Обоснуйте решение и найдите ресурсы для исполнения.'},
 {id:'prologue-03',artKey:'prologue-03',kicker:'Пролог · Совместная работа',title:'У каждого — свои полномочия',body:'В маленькой группе участник может получить несколько должностей и переключаться между ними в профиле. Для действия имеет значение выбранная должность. Договаривайтесь с коллегами и собирайте участников, необходимых для общей задачи.',caption:'Назначения позволяют выполнять разные задачи по очереди.'},
 {id:'prologue-04',artKey:'prologue-04',kicker:'Пролог · Первый ход',title:'Начните с открытого этапа',body:'Откройте раздел «Этапы» и выберите текущий этап. Заполните форму документа, сохраните черновик и передайте его на рассмотрение. Результат останется в этапе, реестре и публичной истории республики.',caption:'После завершения этапа появятся его итоги и следующая глава.'}
];
export default function RepublicComic({open,onClose,intro=false,gameId}:{open:boolean;onClose:()=>void;intro?:boolean;gameId?:string}){
 const [chapters,setChapters]=useState<Chapter[]>([]),[archiveOpen,setArchiveOpen]=useState(false),[error,setError]=useState('');
 const [currentId,setCurrentId]=useState(PROLOGUE[0].id),[playing,setPlaying]=useState(false);
 const channelId=useId(),closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{
  if(!open||intro||!gameId)return;
  let live=true;
  async function refresh(){try{const r=await supabase.from('republic_comic_chapters').select('*').eq('game_id',gameId!).order('stage_no').order('kind');if(!live)return;if(r.error)setError(userError(r.error));else{setChapters(r.data||[]);setError('')}}catch(e){if(live)setError(userError(e))}}
  setChapters([]);void refresh();
  const channel=supabase.channel('comic-chapters-'+channelId).on('postgres_changes',{event:'*',schema:'public',table:'republic_comic_chapters',filter:'game_id=eq.'+gameId},()=>void refresh()).subscribe();
  const timer=window.setInterval(()=>void refresh(),20000);
  return()=>{live=false;window.clearInterval(timer);void supabase.removeChannel(channel)};
 },[open,intro,gameId,channelId]);
 const pages:Page[]=[...PROLOGUE,...(intro?[]:chapters.map(c=>({id:c.id,artKey:c.kind+'-'+String(c.stage_no).padStart(2,'0'),kicker:(c.kind==='completed'?'Итоги':'Анонс')+' · Этап '+c.stage_no,title:c.title,body:c.body,caption:c.kind==='completed'?'Результат на момент завершения этапа.':'Подготовка к следующему этапу.',chapter:c})))];
 const scene=Math.max(0,pages.findIndex(p=>p.id===currentId)),item=pages[scene],last=scene===pages.length-1;
 function close(){if(!intro||last)closeRef.current()}
 const dialog=useDialog(open,close);
 function go(index:number){setCurrentId(pages[Math.max(0,Math.min(pages.length-1,index))].id)}
 useEffect(()=>{if(open){setCurrentId(PROLOGUE[0].id);setPlaying(intro);setArchiveOpen(false)}},[open,intro]);
 useEffect(()=>{
  if(!open||!playing)return;
  const timer=window.setTimeout(()=>{if(last){setPlaying(false);if(intro)closeRef.current()}else go(scene+1)},14000);
  return()=>window.clearTimeout(timer);
 },[open,playing,currentId,intro,pages.length,last]);
 if(!open||typeof document==='undefined')return null;
 const base=process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'',art=(illustrations as Record<string,Artwork>)[item.artKey];
 const groups=[{title:'Пролог',indices:[0,1,2,3]},{title:'Итоги этапов',indices:pages.flatMap((p,i)=>p.chapter?.kind==='completed'?[i]:[])},{title:'Следующий этап',indices:pages.flatMap((p,i)=>p.chapter?.kind==='preview'?[i]:[])}];
 return createPortal(<div className="comicBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!intro)close()}}>
  <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Комикс о Республике" className="comicDialog comicLibrary">
   <header><div className="comicLibraryTitle"><b>GOS//SIMS</b><span>Комиксы республики</span></div><div className="comicHeaderActions">
    <button type="button" aria-label={playing?'Остановить автоматическое воспроизведение':'Продолжить показ'} aria-pressed={playing} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>
    <ComicSoundButton playing={open} iconOnly/>
    <button type="button" aria-label={intro?'Завершить пролог после просмотра':'Закрыть комикс'} disabled={intro&&!last} onClick={close}><X size={20}/></button>
   </div></header>
   {!intro&&<div className="comicArchive"><button type="button" aria-expanded={archiveOpen} onClick={()=>{setArchiveOpen(!archiveOpen);setPlaying(false)}}><BookOpen size={20}/><span>Архив глав · {pages.length}</span><ChevronDown size={18}/></button>
    {archiveOpen&&<nav aria-label="Главы республики">{groups.map(group=><section key={group.title} className="comicChapterGroup"><h3>{group.title}</h3>{group.indices.length?group.indices.map(i=><button key={pages[i].id} type="button" aria-current={scene===i?'step':undefined} onClick={()=>{go(i);setArchiveOpen(false);setPlaying(false)}}>{i<4?'Пролог '+(i+1):pages[i].kicker} · {pages[i].title}</button>):<p>{group.title==='Итоги этапов'?'Итоги появятся после завершения этапа.':'Анонс появится вместе с итогами предыдущего этапа.'}</p>}</section>)}{error&&<p role="status">{error}</p>}</nav>}
   </div>}
   <div className="comicReadingArea"><article className="comicFrame" key={item.id}>
    {art?<img className="comicArtwork" src={base+art.src} srcSet={art.srcSet.split(', ').map(s=>base+s).join(', ')} sizes="(max-width:700px) 100vw, 960px" width={art.width} height={art.height} alt={item.title} decoding="async"/>:<p className="comicArtUnavailable" role="status">Иллюстрация этой главы готовится.</p>}
    <div className="comicOverlay"><span className="comicKicker">{item.kicker}</span><h2>{item.title}</h2><p>{item.body}</p>
     {item.chapter?.kind==='completed'&&<div className="comicChapterResults"><span>Документы: <b>{item.chapter.snapshot?.documents||0} шт.</b></span><span>Голосования: <b>{item.chapter.snapshot?.votes||0} шт.</b></span></div>}
    </div>
   </article></div>
   <footer><div className="comicFooterLabel"><small>{item.caption}{intro?' После пролога откроется настройка профиля.':''}</small><span>{scene+1} / {pages.length}</span></div><div className="comicControls">
    <button type="button" disabled={scene===0} onClick={()=>{setPlaying(false);go(scene-1)}} aria-label="Предыдущая сцена"><ArrowLeft size={20}/></button>
    <button type="button" onClick={()=>{setPlaying(false);last?close():go(scene+1)}} aria-label={last?'Завершить просмотр':'Следующая сцена'}><ArrowRight size={20}/></button>
   </div></footer>
  </section>
 </div>,document.body);
}
