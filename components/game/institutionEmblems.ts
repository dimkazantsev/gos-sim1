const EMBLEM={
 russia:'/emblems/russia.png',
 flag:'/emblems/russian-flag.svg',
 gd:'/emblems/gd.png',
 sf:'/emblems/sf.png',
 minjustUser:'/emblems/minjust-user.jpg',
 interiorUser:'/emblems/interior-user.png',
 centralBank:'/emblems/central-bank.svg',
 transport:'/emblems/transport.png',
 health:'/emblems/health.png',
 finance:'/emblems/finance.png',
 culture:'/emblems/culture.png',
 science:'/emblems/science.png',
 education:'/emblems/education.png',
 economy:'/emblems/economy.png',
 foreign:'/emblems/foreign.png',
 ecology:'/emblems/ecology.jpg',
 labour:'/emblems/labour.png',
 energy:'/emblems/energy.jpg',
 digital:'/emblems/digital.png',
 interior:'/emblems/interior.png',
 emergency:'/emblems/emergency.png'
} as const;

export const gosSimsEmblem=EMBLEM.flag;

export function institutionEmblem(subject:string,issuer=''){
 let key=subject.toLocaleLowerCase('ru-RU');
 const hay=(key+' '+issuer).toLocaleLowerCase('ru-RU');

 if(key==='office'||key.startsWith('office:')){
  if(/депутат|государственн.*дум/.test(hay))key='gd';
  else if(/сенатор|совет федерац/.test(hay))key='sf';
  else if(/министр|министерств/.test(hay))key='ministry';
  else if(/муницип|глава города|местн.*самоуправлен/.test(hay))key='municipality';
 }

 if(key==='minjust'||/министерств.*юстиц|минюст|\bюстиц/.test(hay))return EMBLEM.minjustUser;
 if(key==='interior'||/министерств.*внутренн|\bмвд\b|внутренн.*дел/.test(hay))return EMBLEM.interiorUser;
 if(key==='central_bank'||/центральн.*банк|банк россии/.test(hay))return EMBLEM.centralBank;
 if(key==='gd'||key==='gd_deputy'||/государственн.*дум/.test(hay))return EMBLEM.gd;
 if(key==='sf'||key==='sf_member'||/совет федерац|сенатор/.test(hay))return EMBLEM.sf;

 const ministry:[RegExp,keyof typeof EMBLEM][]=[
  [/транспорт|минтранс/,'transport'],[/здравоохран|минздрав/,'health'],[/финанс|минфин/,'finance'],
  [/культур|минкульт/,'culture'],[/наук|высш.*образован|минобрнаук/,'science'],[/просвещ|минпросвещ/,'education'],
  [/эконом|минэкономразвит/,'economy'],[/иностран|\bмид\b/,'foreign'],[/природ|эколог|минприрод/,'ecology'],
  [/труд|социальн.*защит|минтруд/,'labour'],[/энерг|минэнерго/,'energy'],[/цифров|связи|минцифр/,'digital'],
  [/чрезвычай|\bмчс\b/,'emergency']
 ];
 const ministryKey=ministry.find(([regex])=>regex.test(hay))?.[1];
 if(ministryKey)return EMBLEM[ministryKey];

 // Для органов без отдельного локального файла используем государственный герб,
 // а не внешний URL: так эмблема не исчезает при сетевых ошибках или деплое.
 if(
  key==='president'||key==='government'||key==='ks'||key==='vs'||key==='region'||
  /президент|правительств|конституционн.*суд|верховн.*суд|счетн.*палат|счётн.*палат|прокуратур|следственн.*комитет|избирательн.*комисс|\bцик\b|совет безопасност|государственн.*совет|общественн.*палат|уполномоченн.*прав|росгвард|\bфсб\b|\bсвр\b|\bфсо\b|казначейств|\bфнс\b|\bфтс\b|росстат|роскомнадзор|росреестр|росимущество|\bфас\b|росфинмониторинг|\bфссп\b|\bфсин\b|роспотребнадзор|роструд|роспатент|росархив|минобороны|минсельхоз|минстрой|минпромторг|минспорт|минвостокразвит/.test(hay)
 )return EMBLEM.russia;

 if(key==='municipality'||/муницип|местн.*самоуправлен/.test(hay))return null;
 return EMBLEM.russia;
}
