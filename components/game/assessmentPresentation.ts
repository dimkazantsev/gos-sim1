/** Russian-only labels for internal assessment triggers; raw codes remain in the database. */
const RUN_TYPE_LABELS:Record<string,string>={
 hourly:'Ежечасно',
 manual:'Вручную',
 daily:'Ежедневно',
 nightly:'Ночной пересчёт',
 scheduled:'По расписанию',
 cron:'По расписанию',
 initial:'Первичный расчёт',
 automatic:'Автоматически',
 auto:'Автоматически',
 recalc:'Повторный расчёт',
 event:'После события',
 teacher:'По запросу преподавателя',
 migration:'Обновление системы'
};

export function assessmentRunLabel(runType:string|null|undefined):string{
 const key=(runType||'').trim().toLowerCase();
 return RUN_TYPE_LABELS[key]||'Автоматический пересчёт';
}

/** Keep every word of the saved explanation while separating semantic parts for reading. */
export function assessmentRationaleParagraphs(rationale:string|null|undefined):string[]{
 const text=(rationale||'').trim();
 if(!text)return ['Объяснение оценки пока не сформировано.'];
 return text
  .split(/\s*(?=Критерий\s+[123]\s*[·:—-]|Автооценка\s*:|События\s*:|Правовой критерий\s*:|Блиц и правовые знания\s*:)/u)
  .map(part=>part.trim())
  .filter(Boolean);
}


export type AssessmentRationaleKind='law'|'strategy'|'debrief'|'automatic'|'events'|'legal'|'blitz'|'other';

/** Sections keep the stored calculation verbatim; only headings are interpreted. */
export function assessmentRationaleSections(rationale:string|null|undefined):Record<AssessmentRationaleKind,string[]>{
 const grouped:Record<AssessmentRationaleKind,string[]>={
  law:[],strategy:[],debrief:[],automatic:[],events:[],legal:[],blitz:[],other:[]
 };
 for(const paragraph of assessmentRationaleParagraphs(rationale)){
  const text=paragraph.trim();
  const kind:AssessmentRationaleKind=
   /^Критерий\s+1\s*[·:—-]/u.test(text)?'law':
   /^Критерий\s+2\s*[·:—-]/u.test(text)?'strategy':
   /^Критерий\s+3\s*[·:—-]/u.test(text)?'debrief':
   /^Автооценка\s*:/u.test(text)?'automatic':
   /^События\s*:/u.test(text)?'events':
   /^Правовой критерий\s*:/u.test(text)?'legal':
   /^Блиц и правовые знания\s*:/u.test(text)?'blitz':'other';
  grouped[kind].push(text);
 }
 return grouped;
}

/** Capitalize the first displayed word only. Never mutate the server's original rationale. */
export function assessmentDisplaySentence(text:string):string{
 return text.trim().replace(/^([^\\p{L}\\p{N}]*)(\\p{L})/u,(_,prefix:string,first:string)=>prefix+first.toLocaleUpperCase('ru-RU'));
}

/** Drop the machine-generated heading and display the remaining sentence naturally. */
export function assessmentRationaleDetail(text:string):string{
 const detail=text.replace(/^(?:Критерий\\s+[123]\\s*[·:—-][^:]*|Автооценка|События|Правовой критерий|Блиц и правовые знания)\\s*:\\s*/u,'').trim();
 return assessmentDisplaySentence(detail);
}
