export type FormalSubject={
 key:string;label:string;short:string;roleHints:string[];signatureTitle:string;workflow:string;defaultType:string;
};
export type FormalDocType={key:string;label:string;workflow:string;prefix:string};

export const FORMAL_SUBJECTS:FormalSubject[]=[
 {key:'president',label:'Президент Российской Федерации',short:'Президент РФ',roleHints:['президент'],signatureTitle:'Президент Российской Федерации',workflow:'president_act',defaultType:'president_decree'},
 {key:'gd_deputy',label:'Депутат Государственной Думы',short:'Депутат ГД',roleHints:['депутат'],signatureTitle:'Депутат Государственной Думы',workflow:'bill',defaultType:'fz_bill'},
 {key:'gd',label:'Государственная Дума Федерального Собрания РФ',short:'Государственная Дума',roleHints:['государственн','дум'],signatureTitle:'Председатель Государственной Думы',workflow:'gd_resolution',defaultType:'gd_resolution'},
 {key:'sf',label:'Совет Федерации Федерального Собрания РФ',short:'Совет Федерации',roleHints:['совет федерац','сенатор'],signatureTitle:'Председатель Совета Федерации',workflow:'sf_resolution',defaultType:'sf_resolution'},
 {key:'government',label:'Правительство Российской Федерации',short:'Правительство РФ',roleHints:['правительств','председатель правительств'],signatureTitle:'Председатель Правительства Российской Федерации',workflow:'government_act',defaultType:'government_resolution'},
 {key:'region',label:'Законодательный орган субъекта РФ',short:'Субъект РФ',roleHints:['регион','субъект','законодательн'],signatureTitle:'Председатель законодательного органа субъекта РФ',workflow:'bill',defaultType:'fz_bill'},
 {key:'ks',label:'Конституционный Суд Российской Федерации',short:'КС РФ',roleHints:['конституционн','суд'],signatureTitle:'Председатель Конституционного Суда Российской Федерации',workflow:'bill',defaultType:'fz_bill'},
 {key:'vs',label:'Верховный Суд Российской Федерации',short:'ВС РФ',roleHints:['верховн','суд'],signatureTitle:'Председатель Верховного Суда Российской Федерации',workflow:'bill',defaultType:'fz_bill'},
 {key:'ministry',label:'Федеральное министерство',short:'Министерство',roleHints:['министр','министерств'],signatureTitle:'Федеральный министр',workflow:'ministry_act',defaultType:'ministry_order'},
 {key:'municipality',label:'Орган местного самоуправления',short:'МСУ',roleHints:['муницип','глава города','администрац'],signatureTitle:'Глава муниципального образования',workflow:'municipal_act',defaultType:'municipal_act'}
];

export const FORMAL_TYPES:FormalDocType[]=[
 {key:'fz_bill',label:'Проект федерального закона',workflow:'bill',prefix:'Проект ФЗ'},
 {key:'fkz_bill',label:'Проект федерального конституционного закона',workflow:'bill',prefix:'Проект ФКЗ'},
 {key:'president_decree',label:'Указ Президента РФ',workflow:'president_act',prefix:'Указ'},
 {key:'president_order',label:'Распоряжение Президента РФ',workflow:'president_act',prefix:'Распоряжение'},
 {key:'government_resolution',label:'Постановление Правительства РФ',workflow:'government_act',prefix:'Постановление'},
 {key:'government_order',label:'Распоряжение Правительства РФ',workflow:'government_act',prefix:'Распоряжение'},
 {key:'gd_resolution',label:'Постановление Государственной Думы',workflow:'gd_resolution',prefix:'Постановление ГД'},
 {key:'sf_resolution',label:'Постановление Совета Федерации',workflow:'sf_resolution',prefix:'Постановление СФ'},
 {key:'ministry_order',label:'Приказ федерального министерства',workflow:'ministry_act',prefix:'Приказ'},
 {key:'state_program',label:'Государственная программа',workflow:'government_act',prefix:'Государственная программа'},
 {key:'municipal_act',label:'Муниципальный правовой акт',workflow:'municipal_act',prefix:'Муниципальный акт'},
 {key:'other',label:'Иной формальный институт / документ',workflow:'generic',prefix:'Документ'}
];

export function inferFormal(text:string,title:string,roleTitle?:string|null){
 const hay=(title+'\n'+text).toLowerCase();
 let type='other';
 let subject='gd_deputy';
 if(/федеральн(ый|ого) конституционн(ый|ого) закон|фкз/.test(hay))type='fkz_bill';
 else if(/федеральн(ый|ого) закон|законопроект/.test(hay))type='fz_bill';
 else if(/указ.*президент|президент.*указ/.test(hay))type='president_decree';
 else if(/распоряжение.*президент/.test(hay))type='president_order';
 else if(/постановление.*правительств/.test(hay))type='government_resolution';
 else if(/распоряжение.*правительств/.test(hay))type='government_order';
 else if(/постановление.*государственн.*дум/.test(hay))type='gd_resolution';
 else if(/постановление.*совет.*федерац/.test(hay))type='sf_resolution';
 else if(/приказ.*министерств|приказ.*министр/.test(hay))type='ministry_order';
 else if(/государственн.*программ/.test(hay))type='state_program';
 else if(/муницип|администрац.*города|решение.*думы города/.test(hay))type='municipal_act';

 const role=(roleTitle||'').toLowerCase();
 if(/президент/.test(hay)||/президент/.test(role))subject='president';
 else if(/правительств/.test(hay)||/правительств/.test(role)||/председател.*правительств/.test(role))subject='government';
 else if(/совет.*федерац|сенатор/.test(hay)||/совет.*федерац|сенатор/.test(role))subject='sf';
 else if(/конституционн.*суд/.test(hay)||/конституционн.*суд/.test(role))subject='ks';
 else if(/верховн.*суд/.test(hay)||/верховн.*суд/.test(role))subject='vs';
 else if(/министерств|министр/.test(hay)||/министерств|министр/.test(role))subject='ministry';
 else if(/муницип|глава города|администрац/.test(hay)||/муницип|глава города|администрац/.test(role))subject='municipality';
 else if(/законодательн.*орган.*субъект/.test(hay))subject='region';
 else if(/постановление.*государственн.*дум/.test(hay)||/председател.*дум/.test(role))subject='gd';
 else if(/депутат/.test(role))subject='gd_deputy';

 const t=FORMAL_TYPES.find(x=>x.key===type)||FORMAL_TYPES[FORMAL_TYPES.length-1];
 const s=FORMAL_SUBJECTS.find(x=>x.key===subject)||FORMAL_SUBJECTS[1];
 return {type:t,subject:s};
}

export function formalSignature(subjectKey:string,fullName:string){
 const s=FORMAL_SUBJECTS.find(x=>x.key===subjectKey);
 return {title:s?.signatureTitle||'Уполномоченное лицо',name:fullName};
}

export function ownerLabel(key:string){
 return {
  author:'Автор / субъект инициативы',gd_staff:'Аппарат / Председатель ГД',committee:'Профильный комитет',
  gd_council:'Совет Государственной Думы',gd:'Государственная Дума',sf:'Совет Федерации',
  president:'Президент РФ',government:'Правительство РФ',ministry:'Министерство',municipality:'Муниципальный орган',
  teacher:'Преподаватель',system:'Завершено'
 }[key]||key;
}
