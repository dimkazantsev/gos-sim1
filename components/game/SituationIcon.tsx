'use client';
import type {CSSProperties} from 'react';
import {
 AlertTriangle,BadgeCheck,BookOpenText,BriefcaseBusiness,Building2,CalendarClock,
 CircleHelp,ClipboardList,Coins,Construction,Factory,FileCheck2,Gavel,Handshake,
 HeartPulse,House,Landmark,Lightbulb,Megaphone,Network,RadioTower,Route,Scale,
 Search,ShieldAlert,ShieldCheck,TreePine,TrendingDown,TrendingUp,UsersRound,Vote,
 Wallet,Waves,Wheat,Wrench,Zap
} from 'lucide-react';
import ComicSoundButton from './ComicSoundButton';

/** Bank case art is vector-only. Never fetch original Storage / WebP illustrations here. */
type Glyph=typeof Landmark;
type Topic={key:string;label:string;icon:Glyph;match:RegExp};
const TOPICS:readonly Topic[]=[
 {key:'transport',label:'Транспорт и дороги',icon:Route,match:/дорог|транспорт|мост|переправ|автобус|автомоб|логистик|маршрут|трасс|пассажир|порт|железнодор/},
 {key:'education',label:'Образование',icon:BookOpenText,match:/школ|образован|педагог|учител|университет|вуз|студент|колледж|учени|экзамен|детск.*сад/},
 {key:'health',label:'Здравоохранение',icon:HeartPulse,match:/больниц|врач|медицин|здравоохран|вакцин|пациент|поликлиник|аптек|лекарств|скор.*помощ/},
 {key:'finance',label:'Финансы и бюджет',icon:Wallet,match:/бюджет|налог|финанс|дефицит|доход|расход|долг|субсид|кредит|трансферт|казначей|облигац/},
 {key:'justice',label:'Правосудие',icon:Scale,match:/суд|прокур|конституц|правосуд|юстици|уголов|законност|правонарушен|обжалован/},
 {key:'government',label:'Государственная власть',icon:Landmark,match:/госуправлен|министер|правитель|администрац|ведомств|федеральн|постановлен|регулирован/},
 {key:'elections',label:'Выборы и голосование',icon:Vote,match:/выбор|избирател|голосован|референдум|мандат|депутат|парти|фракци|цик/},
 {key:'security',label:'Безопасность',icon:ShieldCheck,match:/безопасност|полици|угроз|террор|оборону|военн|охрана|преступлен|защит/},
 {key:'ecology',label:'Экология',icon:TreePine,match:/лес|эколог|природ|загрязнен|отход|мусор|заповед|пожар|воздух|выброс/},
 {key:'industry',label:'Промышленность и энергетика',icon:Factory,match:/промышлен|производ|предприяти|завод|энергет|электросет|газ|нефт|теплоснабжен|котельн/},
 {key:'housing',label:'Жильё и городская среда',icon:House,match:/жиль|жилищ|домов|ремонт|благоустрой|коммуналь|строительств|квартир|реновац/},
 {key:'social',label:'Социальная политика',icon:UsersRound,match:/социальн|пенси|семь|семей|молод[её]ж|труд|зарплат|занятост|пособи|инвалид/},
 {key:'emergency',label:'Чрезвычайные ситуации',icon:Waves,match:/наводнен|павод|затоп|стихи|засух|авари|чрезвычайн|кризис|катастроф|спасател/},
 {key:'digital',label:'Цифровизация',icon:Network,match:/цифров|кибер|интернет|сеть|алгоритм|данны|сервер|реестр|телеком|информационн/},
 {key:'media',label:'СМИ и общественные коммуникации',icon:RadioTower,match:/сми|журналист|публикаци|меди|фейк|агитаци|пресс|соцсет|новост|информац.*кампан/},
 {key:'agriculture',label:'Сельское хозяйство',icon:Wheat,match:/сельск|аграр|урожа|фермер|посев|зерно|животновод|орошен|продовольств/},
 {key:'business',label:'Экономика и предпринимательство',icon:BriefcaseBusiness,match:/эконом|бизнес|предпринимател|рынок|торгов|инвестиц|контракт|закуп|экспорт/},
 {key:'municipal',label:'Муниципальное управление',icon:Building2,match:/муницип|поселен|район|город|местн|населен|территори|обществ|культур|музей/}
];
const BADGES:readonly {key:string;icon:Glyph}[]=[
 {key:'alert',icon:AlertTriangle},{key:'approved',icon:BadgeCheck},
 {key:'deadline',icon:CalendarClock},{key:'question',icon:CircleHelp},
 {key:'plan',icon:ClipboardList},{key:'funding',icon:Coins},
 {key:'construction',icon:Construction},{key:'document',icon:FileCheck2},
 {key:'regulation',icon:Gavel},{key:'agreement',icon:Handshake},
 {key:'idea',icon:Lightbulb},{key:'public',icon:Megaphone},
 {key:'audit',icon:Search},{key:'risk',icon:ShieldAlert},
 {key:'decline',icon:TrendingDown},{key:'growth',icon:TrendingUp},
 {key:'maintenance',icon:Wrench},{key:'urgent',icon:Zap}
];
export const SITUATION_ICON_COMBINATIONS=TOPICS.length*BADGES.length; // 324
function fnv(text:string){
 let h=2166136261;
 for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
 return h>>>0;
}
export function resolveSituationIcon(caseKey:string,title:string,category:string){
 const text=(category+' '+title).toLowerCase();
 const topicIndex=TOPICS.findIndex(t=>t.match.test(text));
 const primary=topicIndex>=0?topicIndex:fnv('topic:'+caseKey)%TOPICS.length;
 const seed=fnv(caseKey||category+' '+title);
 // The topic follows the text. A stable modifier adds a second glyph.
 // A short per-case visual code additionally distinguishes cases that share
 // a topic and modifier; no image requests or database migration are needed.
 const secondary=fnv('modifier:'+caseKey)%BADGES.length;
 return{primary,secondary,signature:seed.toString(16).padStart(8,'0'),key:TOPICS[primary].key+'-'+BADGES[secondary].key,label:TOPICS[primary].label};
}
const COLORS=[
 ['#315da8','#e9f1ff','#a8c7f5'],['#317d79','#e8f8f4','#a5ddd6'],
 ['#875fbd','#f4ecff','#d5b9f0'],['#be7453','#fff2e9','#efc2a7'],
 ['#436c92','#eaf5fc','#b9d8f0'],['#7b7460','#f6f3e9','#d5cbab']
] as const;
export default function SituationIcon({title,category,caseKey,compact=false,silent=false}:{title:string;category:string;caseKey:string;compact?:boolean;silent?:boolean}){
 const resolved=resolveSituationIcon(caseKey,title,category);
 const Topic=TOPICS[resolved.primary].icon;
 const Badge=BADGES[resolved.secondary].icon;
 const shade=fnv('shade:'+caseKey)%COLORS.length;
 const [ink,paper,accent]=COLORS[shade];
 const style={'--situation-ink':ink,'--situation-paper':paper,'--situation-accent':accent,
  '--situation-orbit-x':(16+fnv('x:'+caseKey)%66)+'%',
  '--situation-orbit-y':(17+fnv('y:'+caseKey)%65)+'%'} as CSSProperties;
 return <div className="eventComicPlayer">
  <figure className={'eventComic eventPanelIllustration situationSymbol'+(compact?' isCompact':'')}
   data-case={caseKey} data-icon-key={resolved.key} data-icon-fingerprint={resolved.signature}
   style={style} role="img" aria-label={'Иконка ситуации «'+title+'»: '+resolved.label}>
   <span className="situationSymbolOrbit" aria-hidden="true"/>
   <span className="situationSymbolMain" aria-hidden="true"><Topic strokeWidth={1.7}/></span>
   <span className="situationSymbolBadge" aria-hidden="true"><Badge strokeWidth={2}/></span>
   <span className="situationSymbolSerial" aria-hidden="true">{resolved.signature}</span>
  </figure>
  {!silent&&<ComicSoundButton/>}
 </div>;
}
