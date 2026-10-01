export type VotingBody={key:string;title:string;role:RegExp;quorum:number;strictHalf?:boolean;basis:string};
export const VOTING_BODIES:VotingBody[]=[
 {key:'gd',title:'Государственная Дума',role:/депутат|государственн.*дум/i,quorum:.5,strictHalf:true,basis:'База 450 мандатов; кворум 226. Статья 95 Конституции РФ и статья 44 Регламента ГД.'},
 {key:'government',title:'Правительство Российской Федерации',role:/министр|правительств/i,quorum:.5,basis:'Не менее половины состава. Пункт 34 Регламента Правительства РФ; в игре состав равен числу студентов выбранной группы.'},
 {key:'municipality',title:'Муниципальный орган',role:/муницип|глава города|местн.*самоуправлен/i,quorum:.5,basis:'Не менее половины состава; в игре состав равен числу студентов выбранной группы.'},
 {key:'sf',title:'Совет Федерации',role:/совет.*федерац|сенатор/i,quorum:.5,strictHalf:true,basis:'Более половины состава палаты. Численность в игре определяется назначенными участниками.'},
 {key:'committee',title:'Профильный комитет',role:/комитет|депутат/i,quorum:.5,strictHalf:true,basis:'Более половины состава комитета; учебный состав определяется назначениями.'},
 {key:'region',title:'Законодательный орган субъекта РФ',role:/регион|губернатор|субъект.*федерац/i,quorum:.5,strictHalf:true,basis:'Учебный состав. Порог можно повысить согласно регламенту органа.'},
 {key:'cec',title:'Избирательная комиссия',role:/избирательн.*комисс|цик/i,quorum:.5,strictHalf:true,basis:'Большинство установленного состава; статья 28 Федерального закона № 67-ФЗ.'},
 {key:'ks',title:'Конституционный Суд',role:/конституционн.*суд/i,quorum:6/11,basis:'Статья 30 ФКЗ о КС РФ: не менее шести судей. В малой группе учебный кворум масштабируется как 6/11 назначенного состава.'},
 {key:'vs',title:'Верховный Суд',role:/верховн.*суд/i,quorum:2/3,basis:'Учебная модель Пленума: не менее двух третей состава.'},
 {key:'central_bank',title:'Совет директоров Банка России',role:/центральн.*банк|банк.*россии/i,quorum:.5,basis:'Учебный состав и настраиваемый порог заседания.'},
 {key:'accounts',title:'Коллегия Счётной палаты',role:/сч[её]тн.*палат/i,quorum:2/3,basis:'Учебный состав коллегии; не менее двух третей.'}
];
export type VotingUnit={id:string;title:string;unit_kind:string;head_user_id:string|null;unit_key:string};
export function bodyQuorum(key:string,total:number,fraction?:number){const body=VOTING_BODIES.find(b=>b.key===key),value=fraction??body?.quorum??.5;return body?.strictHalf&&Math.abs(value-.5)<.000001?Math.floor(total/2)+1:Math.ceil(total*value-1e-9)}
