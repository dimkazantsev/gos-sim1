import type {FormalDocument} from './types';

export type VotePreset={
 title:string;
 body:string;
 mode:'member'|'faction'|'mandate';
 institutionKey:string;
 procedureKey:string;
 quorumKind:'none'|'fraction';
 quorumValue:number;
 majorityKind:'yes_no_simple'|'present_majority'|'eligible_majority'|'eligible_fraction';
 majorityValue:number;
 allowAbstain:boolean;
 tieBreakerChair:boolean;
 passTransition:'none'|'advance'|'reject'|'return_author'|'return_previous';
 failTransition:'none'|'advance'|'reject'|'return_author'|'return_previous';
 badge:string;
 rule:string;
};

function billThreshold(doc:FormalDocument){
 const fkz=doc.doc_type==='fkz_bill';
 return {
  majorityKind:(fkz?'eligible_fraction':'eligible_majority') as VotePreset['majorityKind'],
  majorityValue:fkz?2/3:0.5,
  rule:fkz?'Не менее 2/3 от общего числа депутатов':'Большинство от общего числа депутатов'
 };
}

export function votePresetForDocument(doc:FormalDocument):VotePreset|null{
 const threshold=billThreshold(doc);

 if(doc.status_code==='president_veto'){
  return {
   title:'Преодоление вето Президента: '+doc.title,
   body:'Государственная Дума решает, одобрить ли федеральный закон в ранее принятой редакции после отклонения Президентом Российской Федерации.',
   mode:'mandate',institutionKey:'gd',procedureKey:'presidential_veto_override',
   quorumKind:'fraction',quorumValue:2/3,
   majorityKind:'eligible_fraction',majorityValue:2/3,
   allowAbstain:true,tieBreakerChair:false,
   passTransition:'advance',failTransition:'reject',
   badge:'ПРЕОДОЛЕНИЕ ВЕТО',rule:'Не менее 2/3 от общего числа депутатов Государственной Думы'
  };
 }

 if(doc.workflow_key==='bill'){
  if(['reading1','reading2','reading3'].includes(doc.status_code)){
   const label=doc.status_code==='reading1'?'I чтение':doc.status_code==='reading2'?'II чтение':'III чтение';
   return {
    title:label+': '+doc.title,
    body:doc.status_code==='reading2'
      ?'Голосование по поправкам и решению о дальнейшем движении законопроекта.'
      :'Голосование Государственной Думы по законопроекту.',
    mode:'mandate',institutionKey:'gd',procedureKey:'bill_'+doc.status_code,
    quorumKind:'fraction',quorumValue:2/3,
    majorityKind:threshold.majorityKind,majorityValue:threshold.majorityValue,
    allowAbstain:true,tieBreakerChair:false,
    passTransition:'advance',failTransition:'reject',
    badge:label.toUpperCase(),rule:threshold.rule
   };
  }
  return null;
 }

 if(doc.workflow_key==='government_act'&&doc.status_code==='agenda'){
  return {
   title:'Рассмотрение Правительством: '+doc.title,
   body:'Голосование членов Правительства по принятию или отклонению документа.',
   mode:'member',institutionKey:'government',procedureKey:'government_decision',
   quorumKind:'fraction',quorumValue:0.5,
   majorityKind:'present_majority',majorityValue:0.5,
   allowAbstain:true,tieBreakerChair:true,
   passTransition:'advance',failTransition:'reject',
   badge:'ЗАСЕДАНИЕ ПРАВИТЕЛЬСТВА',
   rule:'Кворум — не менее половины состава; решение — большинством присутствующих; при равенстве решает председательствующий'
  };
 }

 if(doc.workflow_key==='gd_resolution'&&doc.status_code==='agenda'){
  return {
   title:'Голосование Государственной Думы: '+doc.title,
   body:'Принятие или отклонение проекта постановления Государственной Думы.',
   mode:'mandate',institutionKey:'gd',procedureKey:'gd_resolution',
   quorumKind:'fraction',quorumValue:2/3,
   majorityKind:'eligible_majority',majorityValue:0.5,
   allowAbstain:true,tieBreakerChair:false,
   passTransition:'advance',failTransition:'reject',
   badge:'ПОСТАНОВЛЕНИЕ ГД',rule:'Большинство от общего числа депутатов'
  };
 }

 if(doc.workflow_key==='sf_resolution'&&doc.status_code==='agenda'){
  return {
   title:'Голосование Совета Федерации: '+doc.title,
   body:'Рассмотрение проекта постановления Совета Федерации.',
   mode:'member',institutionKey:'sf',procedureKey:'sf_resolution',
   quorumKind:'fraction',quorumValue:0.5,
   majorityKind:'present_majority',majorityValue:0.5,
   allowAbstain:true,tieBreakerChair:false,
   passTransition:'advance',failTransition:'reject',
   badge:'СОВЕТ ФЕДЕРАЦИИ',rule:'Большинство голосов присутствующих при наличии кворума'
  };
 }

 if(doc.workflow_key==='municipal_act'&&doc.status_code==='meeting'){
  return {
   title:'Муниципальное решение: '+doc.title,
   body:'Рассмотрение проекта муниципальным органом в рамках этапа местного самоуправления.',
   mode:'member',institutionKey:'municipality',procedureKey:'municipal_decision',
   quorumKind:'fraction',quorumValue:0.5,
   majorityKind:'present_majority',majorityValue:0.5,
   allowAbstain:true,tieBreakerChair:false,
   passTransition:'advance',failTransition:'reject',
   badge:'МСУ',rule:'Простое большинство присутствующих'
  };
 }

 return null;
}

export function institutionLabel(key:string){
 return {
  all:'Все участники',factions:'Фракции',gd:'Государственная Дума',
  government:'Правительство РФ',sf:'Совет Федерации',committee:'Профильный комитет',
  municipality:'Муниципальный орган'
 }[key]||key;
}

export function majorityLabel(kind:string,value:number){
 if(kind==='eligible_majority')return 'большинство от общего состава';
 if(kind==='eligible_fraction')return 'не менее '+Math.round(value*100)+'% от общего состава';
 if(kind==='present_majority')return 'большинство присутствующих';
 return 'больше голосов «за», чем «против»';
}
