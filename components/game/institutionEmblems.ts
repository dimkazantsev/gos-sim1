export function institutionEmblem(subject:string,issuer=''){
 if(subject==='municipality'||subject==='region')return null;
 if(subject==='gd'||subject==='gd_deputy')return '/emblems/gd.png';
 if(subject==='sf'||subject==='sf_member')return '/emblems/sf.png';
 if(subject==='ministry'){
  const match:[RegExp,string][]=[[/транспорт/i,'transport'],[/здравоохран/i,'health'],[/финанс/i,'finance'],[/культур/i,'culture'],[/наук|высш/i,'science'],[/просвещ|образован/i,'education'],[/эконом/i,'economy'],[/иностран/i,'foreign'],[/природ|эколог/i,'ecology'],[/труд|социальн.*защит/i,'labour'],[/энерг/i,'energy'],[/цифров|связи|минцифр/i,'digital'],[/внутренн|мвд/i,'interior'],[/чрезвычай|мчс/i,'emergency']];
  const key=match.find(([regex])=>regex.test(issuer))?.[1];if(key)return '/emblems/'+key+(['ecology','energy'].includes(key)?'.jpg':'.png');
 }
 return '/emblems/russia.png';
}
