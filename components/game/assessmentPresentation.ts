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
  .split(/\s*(?=Критерий\s+[123]\s*[·:—-]|Автооценка\s*:|События\s*:|Правовой критерий\s*:)/u)
  .map(part=>part.trim())
  .filter(Boolean);
}
