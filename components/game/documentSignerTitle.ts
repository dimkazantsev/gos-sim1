import type {FormalDocument} from './types';
import {FORMAL_SUBJECTS,formalSubjectDisplayLabel} from './formalInstitutions';

/** Present the office exercised in the game, never the account's technical access role.
 * An explicit signing-office snapshot wins over institutional defaults.
 */
export const MINJUST_REGISTRATION_SIGNER_TITLE='Директор Департамента по делам некоммерческих организаций Министерства юстиции Российской Федерации';
const TECHNICAL_ROLES=/^(?:преподаватель|преподаватель-администратор|администратор(?: игры)?|руководитель симуляции|ведущий игры|учитель|teacher|admin)$/i;

export function documentSignerTitle(
 document:Pick<FormalDocument,'metadata'|'subject_key'|'subject_label'|'doc_type'>,
 capturedRole:unknown
):string{
 // Institutional answers always use the issuing office, not another game office of the teacher.
 if(document.subject_key==='minjust'&&['justice_response','party_certificate'].includes(document.doc_type))
  return MINJUST_REGISTRATION_SIGNER_TITLE;
 const role=typeof capturedRole==='string'?capturedRole.trim():'';
 if(role&&!TECHNICAL_ROLES.test(role))return role;
 const explicit=[document.metadata?.signatory_title,document.metadata?.acting_office_title].find(value=>
  typeof value==='string'&&!!value.trim()&&!TECHNICAL_ROLES.test(value.trim()));
 if(typeof explicit==='string')return explicit.trim();
 if(document.doc_type==='justice_response'||document.doc_type==='party_certificate'||document.subject_key==='minjust')
  return MINJUST_REGISTRATION_SIGNER_TITLE;
 const formal=FORMAL_SUBJECTS.find(item=>item.key===document.subject_key);
 if(formal)return formal.signatureTitle;
 const institution=String(document.metadata?.issuer_name||document.subject_label||'').trim();
 return institution?'Уполномоченное лицо — '+institution:'Уполномоченное должностное лицо';
}

/** UI-only explanation of the authorized signer; not an authorization rule.
 *  Use the already loaded meeting signers when they exist. Never infer
 *  the signer from a participant's other role in another institution.
 */
export function documentSigningAuthority(
 document:Pick<FormalDocument,'metadata'|'subject_key'|'subject_label'|'doc_type'>,
 requiredSigners:ReadonlyArray<{office:string}>=[]
):string{
 const meta=document.metadata||{};
 const issuer=String(meta.issuer_name||meta.issuer||meta.institution||document.subject_label||'').trim();
 const institution=formalSubjectDisplayLabel(document.subject_key,issuer);
 const offices=[...new Set(requiredSigners.map(row=>String(row.office||'').trim()).filter(Boolean))];
 if(offices.length)return institution+' — '+offices.join('; ');
 if(['meeting_agenda','minutes'].includes(document.doc_type))
  return institution+' — состав уполномоченных подписантов пока не подтверждён';
 // The legislator votes on bills, but does not sign the adopted federal law
 // in place of the President. This is a later step in the approved workflow.
 if(['fz_bill','fkz_bill','federal_budget'].includes(document.doc_type))
  return 'Президент Российской Федерации (после прохождения установленной процедуры)';
 if(document.subject_key==='minjust'||['justice_response','party_certificate'].includes(document.doc_type))
  return 'Министерство юстиции Российской Федерации — '+MINJUST_REGISTRATION_SIGNER_TITLE;
 if(document.subject_key==='teacher'&&!issuer)
  return 'Уполномоченный институт не указан в карточке документа';
 return institution+' — '+documentSignerTitle(document,null);
}
