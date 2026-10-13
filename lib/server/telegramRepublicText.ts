/** Resolve addressees without changing the game's prohibition on self-addressed appeals. */
type Recipient={user_id:string;full_name:string|null};
export type AppealMatch=
 |{kind:'found';recipient:Recipient}
 |{kind:'self'}
 |{kind:'missing'}
 |{kind:'ambiguous';hints:string[]};

const surnameOf=(name:string|null)=>name?.trim().split(/\s+/)[0]?.toLocaleLowerCase('ru-RU')||'';
const suffixOf=(id:string)=>id.replace(/-/g,'').slice(0,8).toLocaleLowerCase('ru-RU');

export function resolveAppealRecipient(people:Recipient[],senderId:string,rawTarget:string):AppealMatch{
 const target=rawTarget.trim().replace(/^@/,'').toLocaleLowerCase('ru-RU');
 const matching=people.filter(person=>{
  const surname=surnameOf(person.full_name);
  return surname!==''&&(target===surname||target===surname+'_'+suffixOf(person.user_id));
 });
 const others=matching.filter(person=>person.user_id!==senderId);
 if(others.length===1)return{kind:'found',recipient:others[0]};
 if(others.length===0)return matching.some(person=>person.user_id===senderId)
  ?{kind:'self'}:{kind:'missing'};
 return{kind:'ambiguous',hints:others.slice(0,5).map(person=>
  '@'+surnameOf(person.full_name)+'_'+suffixOf(person.user_id))};
}
export function appealRecipientError(result:Exclude<AppealMatch,{kind:'found'}>):string{
 if(result.kind==='self')return '⚠️ ГОС.ID · Приёмная\n\nОбращение нельзя направить самому себе. Выберите другого действующего участника республики.';
 if(result.kind==='missing')return '⚠️ ГОС.ID · Приёмная\n\nАдресат не найден среди действующих участников республики. Проверьте фамилию и используйте команду /appeal @Фамилия Текст обращения.';
 return '⚠️ ГОС.ID · Приёмная\n\nНайдено несколько адресатов с такой фамилией. Используйте точное обозначение:\n'+result.hints.join('\n')+'.';
}
/** Obsolete internal titles remain untouched in the database. */
export function telegramRepublicName(name:string|null|undefined){
 const cleaned=name?.trim();
 return !cleaned||/^ПАУ$/iu.test(cleaned)?'Республика':cleaned;
}
export function telegramSentence(text:string){
 const value=text.trim();
 return value&&!/[.!?…]$/.test(value)?value+'.':value;
}
