import russia from '@/public/emblems/russia.png';
import russianFlag from '@/public/emblems/russian-flag.svg';
import gd from '@/public/emblems/gd.png';
import sf from '@/public/emblems/sf.png';
import minjustUser from '@/public/emblems/minjust-user.jpg';
import interiorUser from '@/public/emblems/interior-user.png';
import centralBank from '@/public/emblems/central-bank.svg';
import transport from '@/public/emblems/transport.png';
import health from '@/public/emblems/health.png';
import finance from '@/public/emblems/finance.png';
import culture from '@/public/emblems/culture.png';
import science from '@/public/emblems/science.png';
import education from '@/public/emblems/education.png';
import economy from '@/public/emblems/economy.png';
import foreign from '@/public/emblems/foreign.png';
import ecology from '@/public/emblems/ecology.jpg';
import labour from '@/public/emblems/labour.png';
import energy from '@/public/emblems/energy.jpg';
import digital from '@/public/emblems/digital.png';
import interior from '@/public/emblems/interior.png';
import emergency from '@/public/emblems/emergency.png';

type EmblemAsset=string|{src:string};
const assetSrc=(asset:EmblemAsset)=>typeof asset==='string'?asset:asset.src;

const EMBLEM={
 russia:assetSrc(russia),
 flag:assetSrc(russianFlag),
 gd:assetSrc(gd),
 sf:assetSrc(sf),
 minjustUser:assetSrc(minjustUser),
 interiorUser:assetSrc(interiorUser),
 centralBank:assetSrc(centralBank),
 transport:assetSrc(transport),
 health:assetSrc(health),
 finance:assetSrc(finance),
 culture:assetSrc(culture),
 science:assetSrc(science),
 education:assetSrc(education),
 economy:assetSrc(economy),
 foreign:assetSrc(foreign),
 ecology:assetSrc(ecology),
 labour:assetSrc(labour),
 energy:assetSrc(energy),
 digital:assetSrc(digital),
 interior:assetSrc(interior),
 emergency:assetSrc(emergency)
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
