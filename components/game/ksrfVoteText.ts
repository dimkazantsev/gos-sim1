/** Human-readable presentation of KSRF election proposals.
 * Stored enum identifiers stay unchanged: only visible strings are transformed.
 */
const systems:Record<string,string>={
 proportional:'Пропорциональная',majoritarian:'Мажоритарная',mixed:'Смешанная'
};
const allocations:Record<string,string>={
 hare:'Квота Хэйра (наибольшие остатки)',droop:'Квота Друпа (наибольшие остатки)',
 dhondt:'Метод Д’Ондта',sainte_lague:'Метод Сент-Лагю',
 imperiali:'Метод Империали'
};
const majorities:Record<string,string>={
 plurality:'Относительное большинство',absolute_two_round:'Абсолютное большинство, два тура'
};
const regions:Record<string,string>={
 random:'Жеребьёвка',proportional:'Пропорционально числу мандатов Государственной Думы',
 agreement:'По соглашению фракций'
};
export function uppercaseFirst(value:string):string{
 return value.replace(/^\s*([а-яёa-z])/i,(_,initial:string)=>initial.toLocaleUpperCase('ru-RU'));
}
const ruleCaption=(labels:Record<string,string>,key:string)=>Object.hasOwn(labels,key)?labels[key]:/[А-Яа-яЁё]/.test(key)?uppercaseFirst(key):'Параметр не определён';
const period=(value:string)=>/[.!?…]$/.test(value)?value:value+'.';

/** Also renders previously created votes containing enum codes in their body. */
export function formatKsrfVoteBody(procedureKey:string|undefined|null,body:string):string{
 if(!['electoral_system','regional_system'].includes(procedureKey||'')||!body.trim())return body;
 const match=/\.\s*Обоснование:\s*/i.exec(body);
 const header=match?body.slice(0,match.index):body;
 const rationale=match?body.slice(match.index+match[0].length).trim():'';
 const clauses=header.split(/\s*;\s*/).map(raw=>{
  const fragment=raw.trim().replace(/\.$/,'');
  const pair=/^([^:]+):\s*(.+)$/.exec(fragment);
  if(!pair)return uppercaseFirst(fragment);
  const [,label,rawValue]=pair;
  const key=rawValue.trim();
  switch(label.trim().toLocaleLowerCase('ru-RU')){
   case 'система':return 'Система: '+(ruleCaption(systems,key));
   case 'формула':
   case 'метод распределения':
   case 'метод распределения мандатов':
    return 'Метод распределения мандатов: '+(ruleCaption(allocations,key));
   case 'мажоритарное правило':
    return 'Правило определения победителя: '+(ruleCaption(majorities,key));
   case 'пропорциональная часть':
    return 'Доля пропорционального распределения: '+key;
   case 'метод распределения 89 субъектов':
    return 'Способ распределения субъектов Российской Федерации: '+(ruleCaption(regions,key));
   default:return uppercaseFirst(fragment);
  }
 }).filter(Boolean);
 const text=clauses.join('. ');
 if(!rationale)return period(text);
 return period(text)+' Обоснование: '+period(uppercaseFirst(rationale));
}
