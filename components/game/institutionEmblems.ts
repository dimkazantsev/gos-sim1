import russia from '@/public/emblems/russia.png';
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

export function institutionEmblem(subject:string,issuer=''){
 if(subject==='office'||subject.startsWith('office:')){if(/депутат|государственн.*дум/i.test(issuer))subject='gd';else if(/сенатор|совет федерац/i.test(issuer))subject='sf';else if(/министр|министерств/i.test(issuer))subject='ministry';else if(/муницип|глава города/i.test(issuer))subject='municipality';}

 if(subject==='minjust'||/юстиц/i.test(issuer))return EMBLEM.minjustUser;
 if(subject==='interior'||/внутренн|мвд/i.test(issuer))return EMBLEM.interiorUser;
 if(subject==='central_bank'||/центральн.*банк|банк россии/i.test(issuer))return EMBLEM.centralBank;
 if(subject==='municipality'||subject==='region')return null;
 if(subject==='gd'||subject==='gd_deputy')return EMBLEM.gd;
 if(subject==='sf'||subject==='sf_member')return EMBLEM.sf;
 if(subject==='ministry'){
  const match:[RegExp,keyof typeof EMBLEM][]=[[/транспорт/i,'transport'],[/здравоохран/i,'health'],[/финанс/i,'finance'],[/культур/i,'culture'],[/наук|высш/i,'science'],[/просвещ|образован/i,'education'],[/эконом/i,'economy'],[/иностран/i,'foreign'],[/природ|эколог/i,'ecology'],[/труд|социальн.*защит/i,'labour'],[/энерг/i,'energy'],[/цифров|связи|минцифр/i,'digital'],[/внутренн|мвд/i,'interior'],[/чрезвычай|мчс/i,'emergency']];
  const key=match.find(([regex])=>regex.test(issuer))?.[1];if(key)return EMBLEM[key];
 }
 return EMBLEM.russia;
}
