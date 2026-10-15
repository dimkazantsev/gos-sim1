import type {Party,PartyDocument} from './types';
import {latestPartyDocument,latestPartyDocuments,partyDocumentVersionLabel} from './partyDocumentVersions';

export type JusticeDraftDecision='registered'|'rejected'|'revision';
export const PARTY_REQUIRED_DOCS=[
 {kind:'application',name:'Заявление о государственной регистрации'},
 {kind:'charter',name:'Устав политической партии'},
 {kind:'program',name:'Программа политической партии'},
 {kind:'fee',name:'Документ об уплате государственной пошлины'},
 {kind:'symbol',name:'Сведения о символике политической партии'},
 {kind:'congress_minutes',name:'Протокол учредительного съезда'}
] as const;

/** Drafts follow the structure of the supplied Minjust examples, not their 2021 case facts.
 * They never generate a fictitious signature, reference number, finding or decision date.
 */
export function buildPartyJusticeLetter(party:Pick<Party,'name'|'registration_submitted_at'>,docs:PartyDocument[],leaderName:string|undefined,decision:JusticeDraftDecision){
 const submitted=party.registration_submitted_at&&Number.isFinite(Date.parse(party.registration_submitted_at))
  ?new Date(party.registration_submitted_at).toLocaleDateString('ru-RU')
  :'[Дата поступления заявления]';
 const documents=PARTY_REQUIRED_DOCS.map((req,i)=>{
  const match=latestPartyDocument(docs,req.kind);
  const status=!match?'не представлен':match.status==='accepted'?'принят к рассмотрению':match.status==='revision'?'возвращён на доработку':'не прошёл окончательную проверку';
  return (i+1)+'. '+req.name+(match?' ('+partyDocumentVersionLabel(match)+')':'')+' — '+status+'.';
 }).join('\n');
 const recipient=leaderName||'уполномоченному представителю политической партии';
 const header=[
  'МИНИСТЕРСТВО ЮСТИЦИИ РОССИЙСКОЙ ФЕДЕРАЦИИ',
  '(МИНЮСТ РОССИИ)',
  'Департамент по делам некоммерческих организаций',
  '',
  'Адресат: '+recipient,
  'Политическая партия «'+party.name+'»',
  'На заявление'+(party.registration_submitted_at?' от '+submitted:''),
  '',
  'О государственной регистрации политической партии',
  '',
  'Уважаемые представители политической партии «'+party.name+'»!',
  '',
  'Департамент по делам некоммерческих организаций Министерства юстиции Российской Федерации рассмотрел представленный регистрационный пакет политической партии «'+party.name+'» в соответствии с Федеральным законом от 11 июля 2001 г. № 95-ФЗ «О политических партиях», в том числе требованиями статьи 16.',
  '',
  'Сведения о представленных документах:',
  documents,
  ''
 ].join('\n');
 const footer='\n\nДиректор Департамента по делам некоммерческих организаций';
 if(decision==='registered'){
  const latest=latestPartyDocuments(docs);
  const missing=PARTY_REQUIRED_DOCS.filter(req=>!latest.some(d=>d.doc_kind===req.kind&&d.status==='accepted'));
  return header+(missing.length
   ?'Проект положительного решения не может быть подписан до принятия всех обязательных документов. Требуют завершения проверки: '+missing.map(d=>d.name).join('; ')+'.'
   :'По результатам рассмотрения документов принято решение о государственной регистрации политической партии «'+party.name+'». Основание решения — представленный и принятый регистрационный пакет документов.')
   +footer;
 }
 if(decision==='rejected'){
  const revisions=latestPartyDocuments(docs).filter(d=>d.status==='revision'&&d.note?.trim());
  const recorded=revisions.length
   ?'Замечания, зафиксированные при проверке документов (их правовую достаточность необходимо подтвердить):\n'+revisions.map((d,i)=>(i+1)+'. '+d.title+': '+d.note!.trim()).join('\n')+'\n\n'
   :'';
  return header+recorded+'В соответствии с положениями Федерального закона № 95-ФЗ «О политических партиях» отказ в государственной регистрации должен быть обоснован конкретными установленными обстоятельствами.\n\nОснования отказа: [Укажите документально подтверждённые нарушения и применимые нормы закона].\n\nПосле проверки приведённых оснований Министерство юстиции Российской Федерации принимает мотивированное решение об отказе в государственной регистрации политической партии «'+party.name+'». Устранение препятствующих обстоятельств позволяет повторно обратиться за регистрацией в предусмотренном порядке.'+footer;
 }
 return header+'Регистрационный пакет направляется на доработку.\n\nЗамечания: [Укажите документы и требуемые исправления].\n\nПосле устранения замечаний документы могут быть представлены для повторного рассмотрения.'+footer;
}
