export const SURVEY_BLOCKS=[
 {title:'Организационно-методическое обеспечение',questions:[
 'Цели, задачи и правила деловой игры были сформулированы понятно.',
 'Последовательность игровых этапов была логически обоснованной.',
 'Продолжительность игровых этапов соответствовала сложности поставленных задач.',
 'Методические материалы были достаточны для самостоятельного выполнения заданий.',
 'Организация игры обеспечивала возможность полноценного участия в образовательном процессе.']},
 {title:'Институциональная реалистичность',questions:[
 'Игровая модель отражала существенные особенности государственного устройства Российской Федерации.',
 'Распределение полномочий между игровыми институтами соответствовало изучаемой системе публичной власти.',
 'Игровые процедуры способствовали пониманию механизмов принятия государственных решений.',
 'Взаимодействие игровых институтов отражало существенные особенности реальных политических процессов.',
 'Игра способствовала пониманию принципа разделения властей и системы сдержек и противовесов.']},
 {title:'Правовые и управленческие компетенции',questions:[
 'Игра способствовала развитию навыков самостоятельного поиска и применения нормативных правовых актов.',
 'Я стал лучше понимать пределы полномочий должностных лиц и юридические последствия принимаемых решений.',
 'Игра способствовала развитию навыков анализа общественно-политических проблем.',
 'Я развил способность оценивать альтернативные управленческие решения.',
 'Игра способствовала развитию навыков прогнозирования политических, экономических и социальных последствий принимаемых решений.']},
 {title:'Коммуникативные компетенции и коллективное взаимодействие',questions:[
 'Игра способствовала развитию навыков аргументации и публичной защиты собственной позиции.',
 'Я стал лучше понимать интересы различных субъектов политического процесса.',
 'Игра способствовала развитию навыков ведения переговоров и поиска компромиссов.',
 'Участие в игре позволило развить навыки коллективного принятия решений.',
 'Игра способствовала осмыслению личной и коллективной ответственности за результаты деятельности.']},
 {title:'Игровые механики и система оценивания',questions:[
 'Игровые механики соответствовали образовательным целям деловой игры.',
 'Принятые участниками решения оказывали заметное влияние на развитие игрового государства.',
 'Распределение возможностей между игровыми должностями было сбалансированным.',
 'Критерии оценивания игровой деятельности были понятны.',
 'Начисленные баллы отражали мой фактический вклад в игровой процесс.']},
 {title:'Качество цифровой образовательной среды',questions:[
 'Навигация по цифровой платформе ГОС.ID была интуитивно понятной.',
 'Функциональные возможности платформы соответствовали потребностям моей игровой должности.',
 'Информация о состоянии игрового государства была представлена в доступной форме.',
 'Техническая стабильность платформы обеспечивала полноценное участие в игре.',
 'Цифровая платформа способствовала эффективному взаимодействию участников.']},
 {title:'Образовательная эффективность и учебная мотивация',questions:[
 'Игра способствовала повышению моего интереса к изучаемым дисциплинам.',
 'Игровой формат стимулировал самостоятельное изучение научной литературы и законодательства.',
 'Участие в игре позволило установить связь между теоретическими знаниями и практической деятельностью.',
 'Приобретённые в ходе игры компетенции могут быть востребованы в моей будущей профессиональной деятельности.',
 'Использование деловых образовательных игр является целесообразным дополнением к традиционным формам обучения.']}
] as const;
export const SCALE=['','Полностью не согласен','Скорее не согласен','И согласен, и не согласен','Скорее согласен','Полностью согласен'];
export const EXTRA_QUESTIONS=[
 'Сколько времени в среднем в неделю вы уделяли участию в игре?',
 'Какие этапы игры оказались наиболее значимыми для вашего профессионального развития?',
 'Какие игровые механики, на ваш взгляд, требуют совершенствования?',
 'С какими основными затруднениями вы столкнулись в процессе участия в игре?',
 'Как вы оцениваете деловую образовательную игру ГОС.ID в целом?'
];
export const TIME_OPTIONS=['','Менее 1 часа','От 1 до менее 3 часов','От 3 до менее 5 часов','От 5 до менее 8 часов','8 часов и более'];
export const MECHANIC_OPTIONS=['Нет предложений','Распределение должностей и полномочий','Партийная конкуренция и переговоры','Выборы и голосования','Законотворчество и заседания','Государственные программы и бюджет','Ситуации, события и кризисы','Система оценивания','Интерфейс и цифровые инструменты'];
export const DIFFICULTY_OPTIONS=['Не испытывал затруднений','Понимание правил и процедур','Поиск и применение законодательства','Выполнение задач своей должности','Взаимодействие с другими участниками','Нехватка времени','Понимание начисления баллов','Навигация и поиск документов','Технические проблемы'];
export type Answer=number|number[]|null;
export type SurveyDraft={answers:Answer[];proposal:string;section:number};
export type SurveyRow={user_id:string;answers:Answer[];proposal:string;word_count:number;role_title:string|null;team:string|null;group_name:string|null;submitted_at:string};
export const QUESTION_TEXTS=[...SURVEY_BLOCKS.flatMap(b=>[...b.questions]),...EXTRA_QUESTIONS];
export const emptyDraft=():SurveyDraft=>({answers:Array.from({length:40},()=>null),proposal:'',section:0});
export const countWords=(s:string)=>(s.match(/[\p{L}\p{N}]+(?:[-–][\p{L}\p{N}]+)*/gu)||[]).length;
export function validAnswer(i:number,a:Answer|undefined){
 if(i>=36&&i<=38){const max=i===36?16:8;return Array.isArray(a)&&a.length>0&&a.length<=max&&new Set(a).size===a.length&&a.every(x=>Number.isInteger(x)&&x>=(i===36?1:0)&&x<=max)&&(!a.includes(0)||a.length===1)}
 return typeof a==='number'&&Number.isInteger(a)&&a>=1&&a<=(i===39?10:5);
}
export function restoreDraft(raw:string|null):SurveyDraft{
 try{const x=JSON.parse(raw||'null');if(!x||!Array.isArray(x.answers)||x.answers.length!==40||typeof x.proposal!=='string')return emptyDraft();
 const answers=x.answers.map((a:Answer,i:number)=>validAnswer(i,a)?a:null);const first=answers.findIndex((a:Answer)=>a===null);const firstSection=first<0?8:Math.min(7,Math.floor(first/5));return {answers,proposal:x.proposal.slice(0,40000),section:Number.isInteger(x.section)?Math.min(firstSection,Math.max(0,x.section)):0};
 }catch{return emptyDraft()}
}
export function toggleAnswer(old:Answer,value:number):number[]|null{
 const a=Array.isArray(old)?old:[];
 const next=a.includes(value)?a.filter(v=>v!==value):value===0?[0]:[...a.filter(v=>v!==0),value].sort((x,y)=>x-y);
 return next.length?next:null;
}
const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const variance=(a:number[])=>{const m=mean(a);return a.length>1&&m!==null?a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1):null};
export function describe(a:number[]){
 const sorted=[...a].sort((x,y)=>x-y);const mid=Math.floor(a.length/2);const v=variance(a);
 return {n:a.length,mean:mean(a),median:a.length?(a.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2):null,sd:v===null?null:Math.sqrt(v)};
}
const usable=(a:Answer|undefined):a is number=>typeof a==='number'&&a>=1&&a<=5;
export function blockStats(rows:SurveyRow[],block:number){
 const items=rows.map(r=>r.answers.slice(block*5,block*5+5));
 const values=items.map(a=>a.filter(usable)).filter(a=>a.length>=3).map(a=>mean(a) as number);
 const complete=items.filter(a=>a.length===5&&a.every(usable)) as number[][];
 const totals=complete.map(a=>a.reduce((s,x)=>s+x,0));const tv=variance(totals);
 const alpha=complete.length>=2&&tv!==null&&tv>0?1.25*(1-[0,1,2,3,4].reduce((s,i)=>s+(variance(complete.map(a=>a[i]))||0),0)/tv):null;
 return {...describe(values),alpha,alphaN:complete.length};
}
