'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,BookOpen,Library,Pause,Play,X} from 'lucide-react';
import {useDialog} from '../ui/useDialog';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import ComicSoundButton from './ComicSoundButton';
import styles from './RepublicComic.module.css';
const SCENES=[
 {kicker:'ПРОЛОГ · ДЕНЬ НОЛЬ',title:'Республика после бури',body:'Вы пришли к власти не в идеальном государстве. Заводы простаивают, мосты требуют ремонта, бюджет трещит по швам, а граждане больше не верят красивым обещаниям.',stamp:'ДОВЕРИЕ: КРИТИЧЕСКОЕ',caption:'Начало не будет лёгким.'},
 {kicker:'ГЛАВА 01 · ПЕРВЫЙ СИГНАЛ',title:'Казна почти пуста',body:'У вас есть кабинеты, законы, партии и огромное количество вопросов. Деньги заканчиваются быстрее совещаний. Каждая программа забирает ресурсы у другой.',stamp:'РЕСУРСЫ: ОГРАНИЧЕНЫ',caption:'Цена любого решения реальна — хотя республика и вымышленная.'},
 {kicker:'ГЛАВА 02 · НОВЫЕ ИГРОКИ',title:'Люди требуют ответа',body:'Одни требуют рабочих мест. Другие — защиты природы. Третьи хотят мира и порядка. Интересы противоречат друг другу, а коалиции появляются и распадаются.',stamp:'КОНФЛИКТ ИНТЕРЕСОВ',caption:'Договариваться придётся даже с оппонентами.'},
 {kicker:'ВАШ ХОД · РЕСПУБЛИКА',title:'Теперь решаете вы',body:'Создавайте партии, собирайте большинство, готовьте документы, отвечайте на кризисы и восстанавливайте доверие граждан. Здесь история меняется с каждым вашим шагом.',stamp:'НАЧАТЬ ВОССТАНОВЛЕНИЕ',caption:'16 этапов. Одно общее государство. Много разных решений.'}
];
const ARTWORKS=[
 {key:'storm',alt:'Город после бури: мокрые улицы, мост, завод и жители на набережной.'},
 {key:'treasury',alt:'Финансисты разбирают бюджетные документы у открытого пустого сейфа.'},
 {key:'citizens',alt:'Рабочий, учитель и жители обсуждают свои требования с представителем власти.'},
 {key:'renewal',alt:'Молодые представители власти и инженер обсуждают восстановление городского моста.'}
];
function Artwork({scene,cover=false,backdrop=false,alt}:{scene:number;cover?:boolean;backdrop?:boolean;alt?:string}){
 const art=ARTWORKS[scene],base=process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'';
 const file=base+'/republic-art/intro-v2-'+art.key;
 // A portrait backdrop needs enough source pixels for its height as well as its width.
 const sizes=cover?'(max-width:600px) 92vw, (max-width:850px) 45vw, 440px':backdrop?'(max-width:850px) 150vh, (max-width:1420px) 98vw, 1392px':'(max-width:850px) 92vw, 740px';
 return <img className={'comicArtwork '+styles.cinematicArtwork} src={file+'-1920.webp'} srcSet={[480,960,1920].map(width=>file+'-'+width+'.webp '+width+'w').join(', ')} sizes={sizes} width={1920} height={1080} alt={alt||art.alt} data-comic-art={art.key} loading={cover?'lazy':'eager'} decoding="async"/>;
}
function SceneAtmosphere({scene}:{scene:number}){
 return <div className={styles.atmosphere} data-scene-motion={ARTWORKS[scene].key} aria-hidden="true">
  {scene===0&&<div className={styles.rain}>{Array.from({length:40},(_,i)=><i key={i} className={styles.raindrop} style={{left:((i*37)%106)+'%','--duration':(1.7+(i%5)*.22)+'s','--delay':(-i*.27)+'s'} as CSSProperties}/>)}</div>}
  {(scene===0||scene===3)&&<div className={styles.water}>{Array.from({length:9},(_,i)=><i key={i} className={styles.waterGlint} style={{left:(i*11)+'%',top:(10+(i*19)%75)+'%',width:(20+i%4*14)+'px','--duration':(2.6+i%4*.6)+'s','--delay':(-i*.43)+'s'} as CSSProperties}/>)}</div>}
  {scene===1&&<><div className={styles.windowLight}/><div className={styles.dust}>{Array.from({length:12},(_,i)=><i key={i} className={styles.dustMote} style={{left:(50+(i*17)%45)+'%',top:(15+(i*23)%60)+'%',animationDelay:(-i*.8)+'s'}}/>)}</div></>}
  {scene===2&&<div className={styles.wind}>{Array.from({length:10},(_,i)=><i key={i} className={styles.leaf} style={{top:(5+(i*11)%58)+'%','--duration':(6+i%4)+'s','--delay':(-i*.9)+'s'} as CSSProperties}/>)}</div>}
  {scene===3&&<div className={styles.sunrise}/>}
  {(scene===0||scene===3)&&<div className={styles.cloudShadow}/>}
 </div>;
}
function chapterScene(chapter:Chapter){return chapter.stage_no===16?3:chapter.stage_no>=9?1:2}
function defaultPlayback(){return !window.matchMedia('(prefers-reduced-motion: reduce)').matches}
type Chapter={id:string;stage_no:number;kind:'completed'|'preview';title:string;body:string;snapshot:{documents?:number;votes?:number};created_at:string};
function archiveCoverStyle(stage:number,kind:'intro'|'completed'|'preview'){
 const seed=stage*47+(kind==='completed'?17:kind==='preview'?83:151);
 const hue=seed%360,second=(hue+58+(stage*7)%54)%360,third=(hue+188+(stage*11)%48)%360;
 return {
  '--archive-a':`hsl(${hue} 86% 58%)`,
  '--archive-b':`hsl(${second} 91% 65%)`,
  '--archive-c':`hsl(${third} 78% 54%)`,
  '--archive-deep':`hsl(${(hue+8)%360} 55% 12%)`,
  '--archive-shift':`${18+(seed%58)}%`,
 } as CSSProperties;
}
function ArchiveCover({chapter}:{chapter:Chapter}){
 const stage=chapter.stage_no;
 const kind:'completed'|'preview'=chapter.kind;
 const label=kind==='completed'?'ИТОГИ':'АНОНС';
 const code=String(stage).padStart(2,'0');
 const note=kind==='completed'?'СОХРАНЁННЫЙ РЕЗУЛЬТАТ':'СЛЕДУЮЩИЙ ЭТАП';
 return <div className={styles.abstractCover} style={archiveCoverStyle(stage,kind)} data-kind={kind} aria-hidden="true">
  <i className={styles.coverGrid}/>
  <i className={styles.coverGlow}/>
  <i className={styles.coverGlowSecondary}/>
  <div className={styles.coverTopBar}>
   <span className={styles.abstractBrand}>GOS//SIMS</span>
   <span className={styles.abstractIcon}><BookOpen size={18}/></span>
  </div>
  <div className={styles.coverCenter}>
   <div className={styles.coverStageBadge}>
    <small>{label}</small>
    <strong>{code}</strong>
    <span>РЕСПУБЛИКА</span>
   </div>
   <div className={styles.coverMetricStack}>
    <div className={styles.coverMetricCard}><span>НОРМА</span><b>Проект</b><i/></div>
    <div className={styles.coverMetricCard}><span>РЕСУРС</span><b>Баланс</b><i/></div>
    <div className={styles.coverMetricCard}><span>ПРОЦЕСС</span><b>Решение</b><i/></div>
   </div>
  </div>
  <div className={styles.coverFlow}>
   <span className={styles.coverFlowLine}/>
   <i/><i/><i/><i/>
  </div>
  <div className={styles.coverFooter}>
   <span className={styles.abstractKind}>{label}</span>
   <span className={styles.coverFooterNote}>{note}</span>
  </div>
 </div>;
}
type ComicView='intro'|'archive'|'chapter';
type ArchiveState={gameId:string;chapters:Chapter[];loading:boolean;error:string};
export default function RepublicComic({open,onClose,intro=false,gameId,initialView='intro'}:{
 open:boolean;onClose:()=>void;intro?:boolean;gameId?:string;initialView?:'intro'|'archive';
}){
 const [view,setView]=useState<ComicView>(intro?'intro':initialView);
 const [archive,setArchive]=useState<ArchiveState>({gameId:'',chapters:[],loading:false,error:''});
 const [chapterId,setChapterId]=useState(''),[scene,setScene]=useState(0),[playing,setPlaying]=useState(intro||initialView==='intro');
 const [motionRequested,setMotionRequested]=useState(false);
 const reader=useRef<HTMLDivElement>(null),closeRef=useRef(onClose);closeRef.current=onClose;
 const chapters=archive.gameId===gameId?archive.chapters:[];
 const chapter=chapters.find(c=>c.id===chapterId),chapterIndex=chapters.findIndex(c=>c.id===chapterId);
 const showingArchive=!intro&&view==='archive',showingChapter=!intro&&view==='chapter'&&!!chapter;
 const close=()=>{if(!intro||scene===SCENES.length-1)closeRef.current()};
 const dialog=useDialog(open,close);
 useEffect(()=>{
  if(!open)return;
  setView(intro?'intro':initialView);setScene(0);setChapterId('');setPlaying((intro||initialView==='intro')&&defaultPlayback());setMotionRequested(false);
 },[open,intro,initialView,gameId]);
 useEffect(()=>{
  if(!open||intro||!gameId)return;
  let live=true;
  setArchive(previous=>({gameId,chapters:previous.gameId===gameId?previous.chapters:[],loading:true,error:''}));
  void supabase.from('republic_comic_chapters').select('*').eq('game_id',gameId).order('stage_no').order('kind').then(result=>{
   if(!live)return;
   setArchive(previous=>({gameId,chapters:result.error?previous.chapters:(result.data||[]),loading:false,error:result.error?userError(result.error):''}));
  },error=>{
   if(live)setArchive(previous=>({...previous,loading:false,error:userError(error)}));
  });
  return()=>{live=false};
 },[open,intro,gameId,showingArchive]);
 useEffect(()=>{
  if(!open||!playing||showingArchive||showingChapter)return;
  const timer=window.setTimeout(()=>{
   if(scene===SCENES.length-1){setPlaying(false);if(intro)closeRef.current()}
   else setScene(scene+1);
  },8200);
  return()=>window.clearTimeout(timer);
 },[open,playing,scene,intro,showingArchive,showingChapter]);
 useEffect(()=>{reader.current?.scrollTo({top:0})},[view,scene,chapterId]);
 function openIntro(){setScene(0);setChapterId('');setView('intro');setPlaying(defaultPlayback());setMotionRequested(false)}
 function openArchive(){setView('archive');setPlaying(false)}
 function readChapter(id:string){setChapterId(id);setView('chapter');setPlaying(motionRequested||defaultPlayback())}
 function go(index:number){setScene(Math.max(0,Math.min(SCENES.length-1,index)))}
 function togglePlaying(){if(!playing)setMotionRequested(true);setPlaying(!playing)}
 function previous(){if(showingChapter){if(chapterIndex>0)readChapter(chapters[chapterIndex-1].id)}else go(scene-1)}
 function next(){if(showingChapter){if(chapterIndex<chapters.length-1)readChapter(chapters[chapterIndex+1].id);else openArchive()}else if(scene===SCENES.length-1)close();else go(scene+1)}
 if(!open||typeof document==='undefined')return null;
 const item=showingChapter?{
  kicker:(chapter.kind==='completed'?'Итоги':'Анонс')+' · Этап '+chapter.stage_no,
  title:chapter.title,body:chapter.body,stamp:chapter.kind==='completed'?'Итоги сохранены':'Следующий этап',
  caption:chapter.kind==='completed'?'Фактический результат на момент завершения этапа.':'Задачи следующего этапа.'
 }:SCENES[scene];
 return createPortal(<div className={'comicBackdrop '+styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget&&!intro)close()}}>
  <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Комикс о Республике" className={'comicDialog '+styles.dialog} onKeyDown={e=>{
   if(showingArchive||e.altKey||e.ctrlKey||e.metaKey)return;
   if(e.key==='ArrowLeft'){e.preventDefault();previous()}
   if(e.key==='ArrowRight'){e.preventDefault();next()}
  }}>
   <header className={styles.header}><b>GOS//SIMS · Комикс о республике</b><div>
    <ComicSoundButton playing={open} iconOnly/>
    {!showingArchive&&!showingChapter&&<button type="button" aria-label={playing?'Остановить автоматическое воспроизведение':'Продолжить показ'} title={playing?'Пауза анимации и смены сцен':'Включить анимацию и показ сцен'} onClick={togglePlaying}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>}
    {showingChapter&&<button type="button" aria-label="Открыть архив комиксов" title="Архив комиксов" onClick={openArchive}><Library size={19}/></button>}
    <button type="button" aria-label={intro?'Завершить пролог после просмотра':'Закрыть комикс'} disabled={intro&&scene!==SCENES.length-1} onClick={close}><X size={20}/></button>
   </div></header>
   {showingArchive&&<nav className={styles.switcher} aria-label="Разделы комиксов">
    <button type="button" aria-pressed={!showingArchive&&!showingChapter} onClick={openIntro}><BookOpen size={18}/> Пролог</button>
    <button type="button" aria-pressed={showingArchive} onClick={openArchive}><Library size={18}/> Архив комиксов</button>
   </nav>}
   {showingArchive?<div className={styles.library} tabIndex={0}>
    <div className={styles.libraryHeading}><h2>Архив комиксов</h2><p>Пролог доступен всегда. Итоги и анонсы сохраняются по мере завершения этапов вашей игры.</p></div>
    <div className={styles.libraryGrid}>
     <button type="button" className={styles.libraryCard} onClick={openIntro}>
      <div className={`${styles.cover} ${styles.prologueCover}`}>
       <img
        className={styles.archivePrologueCover}
        src={(process.env.NEXT_PUBLIC_ASSET_BASE_PATH||'')+'/republic-art/archive-prologue-storm.webp?v=storm-ocean-20261005b'}
        alt="Республика после бури — обложка пролога."
        width={1920}
        height={1080}
        loading="eager"
        decoding="async"
       />
       <span className={styles.prologueCoverShade} aria-hidden="true"/>
       <span className={styles.prologueCoverGrid} aria-hidden="true"/>
       <div className={styles.prologueCoverTop} aria-hidden="true">
        <b>GOS//SIMS</b>
        <span><BookOpen size={16}/></span>
       </div>
       <div className={styles.prologueCoverCaption} aria-hidden="true">
        <small>ПРОЛОГ · ДЕНЬ НОЛЬ</small>
        <strong>РЕСПУБЛИКА ПОСЛЕ БУРИ</strong>
       </div>
      </div>
      <div className={styles.cardText}><small>Пролог · 4 сцены</small><strong>Пролог Республики</strong><span>Республика после бури: с чего начинается ваша история.</span><b>Открыть пролог <ArrowRight size={16}/></b></div>
     </button>
     {chapters.map(c=><button key={c.id} type="button" className={styles.libraryCard} onClick={()=>readChapter(c.id)}>
      <div className={styles.cover}><ArchiveCover chapter={c}/></div>
      <div className={styles.cardText}><small>{c.kind==='completed'?'Итоги':'Анонс'} · Этап {c.stage_no}</small><strong>{c.title}</strong><span>{c.kind==='completed'?'Сохранённые результаты этапа вашей игры.':'Следующая глава и задачи участников.'}</span><b>Открыть главу <ArrowRight size={16}/></b></div>
     </button>)}
    </div>
    {archive.loading&&<p role="status" className={styles.archiveNotice}>Загружаем главы вашей игры…</p>}
    {!archive.loading&&!chapters.length&&!archive.error&&<p className={styles.archiveNotice}>Этапы пока не завершены. После завершения этапа здесь появятся его итоги и анонс следующей главы.</p>}
    {archive.error&&<p role="status" className={styles.archiveNotice}>Не удалось загрузить главы: {archive.error} Пролог можно читать без загрузки архива.</p>}
   </div>:<>
    <div ref={reader} role="region" aria-label="Сцена комикса" tabIndex={0} data-comic-kind={showingChapter?'chapter':'prologue'} data-playing={playing} data-user-animation={motionRequested} className={'comicFrame '+styles.readerFrame+(!showingChapter?' '+styles.cinematicFrame:'')} key={showingChapter?chapter.id:scene}>
     <div className={styles.illustration}>{showingChapter?<ChapterArtwork chapter={chapter}/>:<Artwork scene={scene} backdrop/>}<SceneAtmosphere scene={showingChapter?chapterScene(chapter):scene}/></div>
     <div className={'comicOverlay '+styles.story}>
      <span className="comicKicker">{item.kicker}</span><h2>{!showingChapter&&scene===0?<>Республика{' '}<br/>после бури</>:item.title}</h2><p>{item.body}</p><strong>{item.stamp}</strong>
     </div>
    </div>
    <footer className={styles.footer}>
     <div className="comicFooterLabel"><small>{item.caption}{intro?' · После пролога откроется настройка профиля.':''}</small><span>{showingChapter?'Глава '+(chapterIndex+1)+' / '+chapters.length:String(scene+1).padStart(2,'0')+' / '+String(SCENES.length).padStart(2,'0')}</span></div>
     <div className={'comicControls '+styles.controls}>
      <button type="button" disabled={showingChapter?chapterIndex<=0:scene===0} onClick={previous} aria-label={showingChapter?'Предыдущая глава':'Предыдущая сцена'}><ArrowLeft size={18}/></button>
      {!showingChapter&&SCENES.map((x,i)=><button key={i} className={'comicDot '+(scene===i?'active':'')} aria-current={scene===i?'step':undefined} aria-label={'Сцена '+(i+1)+': '+x.title} onClick={()=>go(i)}>{String(i+1).padStart(2,'0')}</button>)}
      {showingChapter&&<button type="button" onClick={togglePlaying} aria-label={playing?'Остановить анимацию главы':'Включить анимацию главы'}>{playing?<Pause size={18}/>:<Play size={18}/>}</button>}
      <button type="button" onClick={next} aria-label={showingChapter?(chapterIndex===chapters.length-1?'Вернуться в архив':'Следующая глава'):(scene===SCENES.length-1?'Завершить просмотр':'Следующая сцена')}><ArrowRight size={18}/></button>
     </div>
    </footer>
   </>}
  </section>
 </div>,document.body);
}

function ChapterArtwork({chapter,cover=false}:{chapter:Chapter;cover?:boolean}){
 // The narrative stays in the saved chapter; the illustration reflects its phase.
 const scene=chapterScene(chapter);
 return <Artwork scene={scene} cover={cover} alt={chapter.title+' · '+ARTWORKS[scene].alt}/>;
}
