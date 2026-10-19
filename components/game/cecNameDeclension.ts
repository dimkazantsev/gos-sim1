/**
 * Винительный падеж для типовых русских Ф.И.О.
 * Неизвестная модель имени не склоняется наугад: вызывающий код
 * использует нейтральную юридическую конструкцию.
 */
type PersonGender='male'|'female';
const maleExceptions:Record<string,string>={Павел:'Павла',Лев:'Льва',Пётр:'Петра',Петр:'Петра'};
function preserveCase(original:string,next:string){
 if(original===original.toUpperCase())return next.toUpperCase();
 if(original[0]===original[0].toLowerCase())return next[0].toLowerCase()+next.slice(1);
 return next;
}
function inflectGivenName(name:string,gender:PersonGender){
 if(gender==='male'&&maleExceptions[name])return maleExceptions[name];
 if(gender==='female'&&/ь$/iu.test(name))return name;
 if(/ия$/iu.test(name))return name.slice(0,-1)+'ю';
 if(/а$/iu.test(name))return name.slice(0,-1)+'у';
 if(/я$/iu.test(name))return name.slice(0,-1)+'ю';
 if(gender==='male'){
  if(/ь$/iu.test(name))return name.slice(0,-1)+'я';
  if(/й$/iu.test(name))return name.slice(0,-1)+'я';
  if(/[бвгджзклмнпрстфхцчшщ]$/iu.test(name))return name+'а';
 }
 return name;
}
function inflectFamilyName(surname:string,gender:PersonGender){
 const process=(part:string)=>{
  if(/(?:енко|ко|ых|их|иа|уа|е)$/iu.test(part))return part;
  if(gender==='female'){
   if(/ская$/iu.test(part))return part.slice(0,-4)+'скую';
   if(/ая$/iu.test(part))return part.slice(0,-2)+'ую';
   if(/ия$/iu.test(part))return part.slice(0,-1)+'ю';
   if(/а$/iu.test(part))return part.slice(0,-1)+'у';
   if(/я$/iu.test(part))return part.slice(0,-1)+'ю';
   return part;
  }
  if(/ский$/iu.test(part))return part.slice(0,-4)+'ского';
  if(/цкий$/iu.test(part))return part.slice(0,-4)+'цкого';
  if(/ый$/iu.test(part))return part.slice(0,-2)+'ого';
  if(/ой$/iu.test(part))return part.slice(0,-2)+'ого';
  if(/ий$/iu.test(part))return part.slice(0,-2)+'его';
  if(/а$/iu.test(part))return part.slice(0,-1)+'у';
  if(/я$/iu.test(part))return part.slice(0,-1)+'ю';
  if(/ь$/iu.test(part))return part.slice(0,-1)+'я';
  if(/й$/iu.test(part))return part.slice(0,-1)+'я';
  if(/[бвгджзклмнпрстфхцчшщ]$/iu.test(part))return part+'а';
  return part;
 };
 return surname.split('-').map(process).join('-');
}
export function cecAccusativeFullName(fullName:string):string|null{
 const tokens=fullName.trim().split(/\s+/u);
 if(tokens.length!==3||tokens.some(x=>!/^[-А-Яа-яЁё]+$/u.test(x)))return null;
 const [surname,name,patronymic]=tokens;
 const gender:PersonGender|null=/(?:ович|евич|ич)$/iu.test(patronymic)?'male':
  /(?:овна|евна|ична)$/iu.test(patronymic)?'female':null;
 if(!gender)return null;
 const changedPatronymic=gender==='male'?patronymic+'а':
  /а$/iu.test(patronymic)?patronymic.slice(0,-1)+'у':patronymic;
 return [inflectFamilyName(surname,gender),inflectGivenName(name,gender),changedPatronymic].join(' ');
}
export function cecRegistrationDirective(fullName:string):string{
 const accusative=cecAccusativeFullName(fullName);
 return accusative?
  'Зарегистрировать '+accusative+' кандидатом на должность Президента Российской Федерации.':
  'Зарегистрировать кандидата на должность Президента Российской Федерации: '+fullName.trim()+'.';
}
