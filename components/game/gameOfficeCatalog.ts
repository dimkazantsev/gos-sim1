// Single catalogue for the offices actually modelled in the sixteen ГОС.ID stages.
// Do not copy a list of real-world ministries here: the game has FIVE portfolios.
// When Stage 8 approves different titles, use those five approved names, not
// additional offices. Historic appointments are not changed by this catalogue.
export type RoleGroup={label:string;roles:string[]};
export type PortfolioKey='social'|'economic'|'defence'|'foreign'|'internal';
export type GameUnit={unit_kind:string;unit_key:string;title:string};
export type GameGovernmentStructure=Partial<Record<
 'social_title'|'economic_title'|'defence_title'|'foreign_title'|'internal_title'|'status',string>>;

export const GAME_MINISTRIES:ReadonlyArray<{key:PortfolioKey;title:string}>=[
 {key:'social',title:'Министерство по социальной политике'},
 {key:'economic',title:'Министерство по экономической политике'},
 {key:'defence',title:'Министерство по обороне и внутренней безопасности'},
 {key:'foreign',title:'Министерство по внешней политике'},
 {key:'internal',title:'Министерство по внутренней политике и государству'}
];

export const GAME_COMMITTEES:ReadonlyArray<{key:PortfolioKey;title:string}>=[
 {key:'social',title:'Комитет по социальной политике'},
 {key:'economic',title:'Комитет по экономической политике'},
 {key:'defence',title:'Комитет по обороне и безопасности'},
 {key:'foreign',title:'Комитет по внешней политике'},
 {key:'internal',title:'Комитет по внутренней политике и государству'}
];

const BARNAUL_DISTRICTS=['Железнодорожного','Индустриального','Ленинского','Октябрьского','Центрального'] as const;

function ministerOffice(title:string):string{
 const source=title.trim();
 // Official titles in Stage 8 are usually "Министерство по ...".
 return /^Министерство\s+/iu.test(source)
  ?source.replace(/^Министерство\s+/iu,'Министр ')
  :'Министр — '+source;
}
function committeeOffice(title:string,head:boolean):string{
 const prefix=head?'Председатель комитета':'Член комитета';
 const suffix=title.trim().replace(/^Комитет\s+/iu,'');
 return prefix+' Государственной Думы '+suffix;
}
export function gameOfficeGroups(structure:GameGovernmentStructure|null=null,units:GameUnit[]=[]):RoleGroup[]{
 const unit=(kind:string,key:string)=>units.find(x=>x.unit_kind===kind&&x.unit_key===key)?.title?.trim();
 const ministryTitles=GAME_MINISTRIES.map(x=>{
  const field=(x.key+'_title') as keyof GameGovernmentStructure;
  const approved=structure?.status==='approved'?structure[field]?.trim():undefined;
  return approved||unit('ministry',x.key)||x.title;
 });
 const committeeTitles=GAME_COMMITTEES.map(x=>unit('committee',x.key)||x.title);
 const groups:RoleGroup[]=[
  {label:'КСРФ, партии и фракции',roles:[
   'Член КСРФ','Председатель политической партии','Руководитель фракции Государственной Думы'
  ]},
  {label:'Государственная Дума и Совет Федерации',roles:[
   'Депутат Государственной Думы','Председатель Государственной Думы',
   'Заместитель Председателя Государственной Думы',
   'Сенатор Российской Федерации','Председатель Совета Федерации'
  ]},
  {label:'Пять комитетов Государственной Думы',roles:[
   ...committeeTitles.map(x=>committeeOffice(x,true)),
   ...committeeTitles.map(x=>committeeOffice(x,false))
  ]},
  {label:'Президент и руководство Правительства',roles:[
   'Президент Российской Федерации','Председатель Правительства Российской Федерации',
   'Заместитель Председателя Правительства Российской Федерации'
  ]},
  {label:'Пять министерств Правительства',roles:[
   ...ministryTitles.map(ministerOffice),
   ...ministryTitles.map(x=>ministerOffice(x).replace(/^Министр(?=\s)/u,'Заместитель министра')),
   ...ministryTitles.map(x=>'Сотрудник — '+x)
  ]},
  {label:'Другие органы игровой процедуры',roles:[
   'Председатель Банка России',
   'Председатель Центральной избирательной комиссии Российской Федерации',
   'Председатель Конституционного Суда Российской Федерации'
  ]},
  {label:'Местное самоуправление Барнаула',roles:[
   'Глава города Барнаула',
   ...BARNAUL_DISTRICTS.map(x=>'Глава администрации '+x+' района города Барнаула'),
   ...BARNAUL_DISTRICTS.map(x=>'Сотрудник администрации '+x+' района города Барнаула')
  ]}
 ];
 // One office per option, regardless of groups and name changes.
 const seen=new Set<string>();
 return groups.map(g=>({...g,roles:g.roles.filter(role=>{
  const key=role.toLocaleLowerCase('ru-RU');
  if(seen.has(key))return false;seen.add(key);return true;
 })}));
}
export function gameOfficeRoleList(groups:RoleGroup[]):string[]{
 return groups.flatMap(group=>group.roles);
}
