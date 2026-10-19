export type CecDecisionStatus='registered'|'revision'|'rejected'|'withdrawn'|'submitted';
export function cecOfficialResolution(status:CecDecisionStatus,name:string,original?:string|null){
 if(status==='registered')return 'Зарегистрирован кандидат '+name+' на должность Президента Российской Федерации.';
 if(status==='revision')return 'Документы кандидата '+name+' возвращены на доработку по замечаниям Центральной избирательной комиссии Российской Федерации.';
 const text=(original||'').trim();
 if(text&&!/учебн|редуцирован|автоматическ|предлагается зарегистрировать/i.test(text))return text;
 if(status==='rejected')return 'В регистрации кандидата '+name+' отказано по основаниям, изложенным в решении Центральной избирательной комиссии Российской Федерации.';
 return 'Решение Центральной избирательной комиссии Российской Федерации принято.';
}
