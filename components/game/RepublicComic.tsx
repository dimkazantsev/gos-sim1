'use client';
import {useEffect,useRef,useState} from 'react';
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
function Artwork({scene}:{scene:number}){
 return <svg className={'comicArtwork s'+scene} viewBox="0 0 900 510" role="img" aria-label={SCENES[scene].title} preserveAspectRatio="xMidYMid slice">
  <defs>
   <linearGradient id="comicNight" x1="0" y1="0" x2="1" y2="1"><stop stopColor={scene===3?'#0c3d7d':'#101837'}/><stop offset=".55" stopColor={scene===3?'#2275b1':'#442e73'}/><stop offset="1" stopColor={scene===3?'#ffc46f':'#fc665d'}/></linearGradient>
   <linearGradient id="comicCity" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#314d74"/><stop offset="1" stopColor="#111b3c"/></linearGradient>
   <radialGradient id="comicGlow"><stop stopColor="#ffe78a" stopOpacity="1"/><stop offset="1" stopColor="#ff9a6b" stopOpacity="0"/></radialGradient>
  </defs>
  <rect width="900" height="510" fill="url(#comicNight)"/>
  <g className="comicCelestial"><circle cx={scene===3?713:722} cy={scene===3?158:155} r={scene===3?142:95} fill="url(#comicGlow)"/><circle cx={scene===3?713:722} cy={scene===3?158:155} r={scene===3?52:33} fill="#fff0a3"/></g>
  <g className="comicClouds" fill="#1b254f" opacity=".55"><ellipse cx="135" cy="125" rx="180" ry="50"/><ellipse cx="449" cy="64" rx="172" ry="38"/><ellipse cx="775" cy="120" rx="155" ry="44"/></g>
  <g className="comicHills" fill="#23365e"><path d="M0 365 141 259 246 306 346 240 455 332 554 260 663 325 798 234 900 290V510H0Z"/></g>
  <g className="comicBuildings" fill="url(#comicCity)" stroke="#10162d" strokeWidth="5">
   <path d="M0 509V305H102V509ZM129 509V236H207V509ZM226 509V312H299V509ZM319 509V199H400V509ZM427 509V281H534V509ZM549 509V227H628V509ZM650 509V311H747V509ZM764 509V265H900V509Z"/>
  </g>
  <g fill={scene===3?'#80f5d5':'#e9b96c'} opacity={scene===3?'.95':'.40'}>
   {Array.from({length:26},(_,i)=><rect key={i} x={16+(i%9)*94} y={320+Math.floor(i/9)*52} width="13" height="21" rx="2"/>)}
  </g>
  {scene<3&&<g className="comicBroken" fill="#181d3c"><path d="M318 199 343 160 365 196 390 180 400 199Z"/><path d="M143 236 155 207 169 227 181 196 196 236Z"/><path d="M760 266 791 223 819 251 833 217 853 265Z"/></g>}
  {scene===0&&<g className="comicStorm" fill="none" stroke="#d2deff" strokeWidth="2" opacity=".55">
    {Array.from({length:19},(_,i)=><path key={i} d={'m'+(i*53-70)+' '+(i%3*59+8)+' -40 95'}/>)}
   <path stroke="#fff3b0" strokeWidth="10" d="m520 35-40 92 32-6-42 88"/></g>}
  {scene===0&&<g className="comicEmergency">
    <path d="M0 405q155-48 260-16t295-13t360 14" stroke="#607fa4" strokeWidth="33" fill="none"/>
    <path d="M80 411h155v-58H80l23-45h89l36 45h25v58Z" fill="#e2e5d9" stroke="#213453" strokeWidth="8"/>
    <path d="M146 323v30m-16-15h32" stroke="#ff6874" strokeWidth="12"/>
    <circle cx="114" cy="410" r="18" fill="#141e31"/><circle cx="213" cy="410" r="18" fill="#141e31"/>
    <path d="m354 354 33-65 63 48 54-33 32 64" stroke="#f7c2a7" strokeWidth="13" fill="none"/>
    <g strokeWidth="11" fill="none" strokeLinecap="round"><path d="M545 398q30-46 57 0" stroke="#a9ffdc"/><path d="M560 362v-40" stroke="#a9ffdc"/></g>
   </g>}
  {scene===1&&<g className="comicVault">
    <rect x="302" y="226" width="274" height="244" rx="20" fill="#263354" stroke="#f7c87b" strokeWidth="8"/>
    <circle cx="440" cy="343" r="88" fill="#1c2548" stroke="#9faec8" strokeWidth="12"/>
    <circle cx="440" cy="343" r="39" fill="#54617b" stroke="#ffdb8c" strokeWidth="7"/>
    <path d="M440 295v96m-48-48h96m-82-33 68 68m-1-69-67 69" stroke="#ffd38c" strokeWidth="9" strokeLinecap="round"/>
    <path d="M320 238H558" stroke="#f5a26d" strokeWidth="5" strokeDasharray="12 12"/></g>}
  {scene===2&&<g className="comicCrowd">
   {Array.from({length:14},(_,i)=><g key={i} transform={'translate('+(30+i*65)+','+(340+(i%3)*26)+')'}>
    <circle cx="0" cy="0" r="18" fill={i%3===0?'#ffd5a7':'#9bd6f9'}/>
    <path d="M-26 68Q-28 22 0 21Q29 22 27 68Z" fill={i%2?'#6a74ff':'#f6708c'}/>
   </g>)}
   <path d="M340 239h225v87H340Z" fill="#fce6bc" stroke="#342c56" strokeWidth="7" transform="rotate(-7 450 275)"/>
   <text x="361" y="286" fontSize="28" fontWeight="900" fill="#172b53" transform="rotate(-7 450 275)">ГДЕ РЕШЕНИЯ?</text></g>}
  {scene===3&&<g className="comicRebirth">
   <path d="M130 389H768V430H130Z" fill="#83d4d9" stroke="#173252" strokeWidth="9"/>
   <path d="M195 430V510M704 430V510M245 388Q450 144 655 388" fill="none" stroke="#fbe3a4" strokeWidth="17"/>
   <path d="M274 340V388M357 269V388M452 247V388M546 274V388M628 345V388" stroke="#f8e8bf" strokeWidth="7"/>
   <g transform="translate(403 342)"><circle cx="0" cy="0" r="17" fill="#f5c097"/><path d="M-21 43V26Q0 7 23 26V43" fill="#fa947c"/><path d="M-13 43V47M16 43V47" stroke="#142a47" strokeWidth="9"/></g>
   <g transform="translate(540 342)"><circle cx="0" cy="0" r="17" fill="#d69f7d"/><path d="M-21 43V26Q0 7 23 26V43" fill="#7fe3c3"/></g>
   <path d="m420 226 0-105" stroke="#fcf6dc" strokeWidth="12"/>
   <path d="M426 118Q520 91 587 148Q513 196 426 175Z" fill="#51e7c9"/>
   <path d="M-10 474Q290 365 559 450T930 418" fill="none" stroke="#f4e79d" strokeWidth="12" strokeLinecap="round"/>
   <g fill="#e8fff7">{Array.from({length:12},(_,i)=><circle key={i} cx={55+i*75} cy={75+i%4*28} r={3+i%3}/>)}</g>
  </g>}
  <path d="M0 509V474Q100 468 200 479T400 472T600 481T900 461V509Z" fill="#111d35"/>
 </svg>;
}
type Chapter={id:string;stage_no:number;kind:'completed'|'preview';title:string;body:string;snapshot:{documents?:number;votes?:number};created_at:string};
type ComicView='intro'|'archive'|'chapter';
type ArchiveState={gameId:string;chapters:Chapter[];loading:boolean;error:string};
export default function RepublicComic({open,onClose,intro=false,gameId,initialView='intro'}:{
 open:boolean;onClose:()=>void;intro?:boolean;gameId?:string;initialView?:'intro'|'archive';
}){
 const [view,setView]=useState<ComicView>(intro?'intro':initialView);
 const [archive,setArchive]=useState<ArchiveState>({gameId:'',chapters:[],loading:false,error:''});
 const [chapterId,setChapterId]=useState(''),[scene,setScene]=useState(0),[playing,setPlaying]=useState(intro);
 const reader=useRef<HTMLDivElement>(null),closeRef=useRef(onClose);closeRef.current=onClose;
 const chapters=archive.gameId===gameId?archive.chapters:[];
 const chapter=chapters.find(c=>c.id===chapterId),chapterIndex=chapters.findIndex(c=>c.id===chapterId);
 const showingArchive=!intro&&view==='archive',showingChapter=!intro&&view==='chapter'&&!!chapter;
 const close=()=>{if(!intro||scene===SCENES.length-1)closeRef.current()};
 const dialog=useDialog(open,close);
 useEffect(()=>{
  if(!open)return;
  setView(intro?'intro':initialView);setScene(0);setChapterId('');setPlaying(intro);
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
 function openIntro(){setScene(0);setChapterId('');setView('intro');setPlaying(false)}
 function openArchive(){setView('archive');setPlaying(false)}
 function readChapter(id:string){setChapterId(id);setView('chapter');setPlaying(false)}
 function go(index:number){setScene(Math.max(0,Math.min(SCENES.length-1,index)));setPlaying(false)}
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
   <header className={styles.header}><b>GOS//SIMS · Комиксы республики</b><div>
    {!showingArchive&&<ComicSoundButton playing={playing||showingChapter} iconOnly/>}
    {!showingArchive&&!showingChapter&&<button type="button" aria-label={playing?'Остановить автоматическое воспроизведение':'Продолжить показ'} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>}
    <button type="button" aria-label={intro?'Завершить пролог после просмотра':'Закрыть комикс'} disabled={intro&&scene!==SCENES.length-1} onClick={close}><X size={20}/></button>
   </div></header>
   {!intro&&<nav className={styles.switcher} aria-label="Разделы комиксов">
    <button type="button" aria-pressed={!showingArchive&&!showingChapter} onClick={openIntro}><BookOpen size={18}/> Вводный комикс</button>
    <button type="button" aria-pressed={showingArchive} onClick={openArchive}><Library size={18}/> Архив комиксов</button>
   </nav>}
   {showingArchive?<div className={styles.library} tabIndex={0}>
    <div className={styles.libraryHeading}><h2>Архив комиксов</h2><p>Вводный комикс доступен всегда. Итоги и анонсы сохраняются по мере завершения этапов вашей игры.</p></div>
    <div className={styles.libraryGrid}>
     <button type="button" className={styles.libraryCard} onClick={openIntro}>
      <div className={styles.cover}><Artwork scene={0}/></div>
      <div className={styles.cardText}><small>Пролог · 4 сцены</small><strong>Вводный комикс</strong><span>Республика после бури: с чего начинается ваша история.</span><b>Читать с начала <ArrowRight size={16}/></b></div>
     </button>
     {chapters.map(c=><button key={c.id} type="button" className={styles.libraryCard} onClick={()=>readChapter(c.id)}>
      <div className={styles.cover}><ChapterArtwork chapter={c}/></div>
      <div className={styles.cardText}><small>{c.kind==='completed'?'Итоги':'Анонс'} · Этап {c.stage_no}</small><strong>{c.title}</strong><span>{c.kind==='completed'?'Сохранённые результаты этапа вашей игры.':'Следующая глава и задачи участников.'}</span><b>Открыть главу <ArrowRight size={16}/></b></div>
     </button>)}
    </div>
    {archive.loading&&<p role="status" className={styles.archiveNotice}>Загружаем главы вашей игры…</p>}
    {!archive.loading&&!chapters.length&&!archive.error&&<p className={styles.archiveNotice}>Этапы пока не завершены. После завершения этапа здесь появятся его итоги и анонс следующей главы.</p>}
    {archive.error&&<p role="status" className={styles.archiveNotice}>Не удалось загрузить главы: {archive.error} Вводный комикс можно читать без загрузки архива.</p>}
   </div>:<>
    <div ref={reader} role="region" aria-label="Сцена комикса" tabIndex={0} className={'comicFrame '+styles.readerFrame} key={showingChapter?chapter.id:scene}>
     <div className={styles.illustration}>{showingChapter?<ChapterArtwork chapter={chapter}/>:<Artwork scene={scene}/>}</div>
     <div className={'comicOverlay '+styles.story}>
      <span className="comicKicker">{item.kicker}</span><h2>{item.title}</h2><p>{item.body}</p><strong>{item.stamp}</strong>
     </div>
    </div>
    <footer className={styles.footer}>
     <div className="comicFooterLabel"><small>{item.caption}{intro?' · После пролога откроется настройка профиля.':''}</small><span>{showingChapter?'Глава '+(chapterIndex+1)+' / '+chapters.length:'Сцена '+(scene+1)+' / '+SCENES.length}</span></div>
     <div className={'comicControls '+styles.controls}>
      <button type="button" disabled={showingChapter?chapterIndex<=0:scene===0} onClick={previous} aria-label={showingChapter?'Предыдущая глава':'Предыдущая сцена'}><ArrowLeft size={18}/></button>
      {!showingChapter&&SCENES.map((x,i)=><button key={i} className={'comicDot '+(scene===i?'active':'')} aria-current={scene===i?'step':undefined} aria-label={'Сцена '+(i+1)+': '+x.title} onClick={()=>go(i)}>{String(i+1).padStart(2,'0')}</button>)}
      <button type="button" onClick={next} aria-label={showingChapter?(chapterIndex===chapters.length-1?'Вернуться в архив':'Следующая глава'):(scene===SCENES.length-1?'Завершить просмотр':'Следующая сцена')}><ArrowRight size={18}/></button>
     </div>
    </footer>
   </>}
  </section>
 </div>,document.body);
}

function ChapterArtwork({chapter:c}:{chapter:Chapter}){if(!c)return null;const p=(c.stage_no-1)%4,colors=['#327bea','#c2438a','#279982','#7a58b1'];return <svg className="comicArtwork" viewBox="0 0 1920 1080" role="img" aria-label={c.title} preserveAspectRatio="xMidYMid slice"><rect width="1920" height="1080" fill="#e6f1fd"/><circle cx={1490+p*40} cy="240" r="160" fill="#ffd68a"/><path d="M0 780Q460 590 940 740T1920 660V1080H0Z" fill="#b9d8e7"/><g stroke="#173253" strokeWidth="10"><path d="M90 880V500H230V880M260 880V390H390V880M1560 880V470H1710V880M1740 880V560H1900V880" fill="#8bacd1"/><path d="M610 770V340H1320V770Z" fill="#fff"/><path d="M610 340L965 150L1320 340Z" fill={colors[p]}/><path d="M760 420H1190M760 490H1140M760 560H1190" stroke="#aac0dd"/><rect x="720" y="635" width="480" height="100" rx="16" fill={colors[p]}/></g><text x="962" y="710" textAnchor="middle" fill="#fff" fontSize="60" fontWeight="900">Этап {String(c.stage_no).padStart(2,'0')}</text><g transform="translate(450 710)"><circle cy="-80" r="58" fill="#ebbd9c" stroke="#173253" strokeWidth="9"/><path d="M-90 220V40Q-80-20 0-20Q80-20 90 40V220Z" fill={colors[p]}/><path d="M65 65L260-20" stroke={colors[p]} strokeWidth="42" strokeLinecap="round"/><path d="M-30 220L-45 320M40 220L60 320" stroke="#173253" strokeWidth="40"/></g><g transform="translate(1420 710)"><circle cy="-80" r="58" fill="#d2a082" stroke="#173253" strokeWidth="9"/><path d="M-90 220V40Q-80-20 0-20Q80-20 90 40V220Z" fill="#e079a9"/><path d="M-65 65L-250-20" stroke="#e079a9" strokeWidth="42" strokeLinecap="round"/><path d="M-30 220L-45 320M40 220L60 320" stroke="#173253" strokeWidth="40"/></g>{c.kind==='completed'&&<g fill="#173253" fontSize="34" fontWeight="800"><text x="690" y="850">Документы: {c.snapshot.documents||0}</text><text x="1030" y="850">Голосования: {c.snapshot.votes||0}</text></g>}</svg>}
