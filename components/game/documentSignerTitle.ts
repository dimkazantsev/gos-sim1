import type {FormalDocument} from './types';
import {FORMAL_SUBJECTS} from './formalInstitutions';

/** Present the office exercised in the game, never the account's technical access role.
 * An explicit signing-office snapshot wins over institutional defaults.
 */
export const MINJUST_REGISTRATION_SIGNER_TITLE='Директор Департамента по делам некоммерческих организаций Министерства юстиции Российской Федерации';
const TECHNICAL_ROLES=/^(?:преподаватель|администратор|руководитель симуляции|ведущий игры|учитель|teacher|admin)$/i;

export function documentSignerTitle(
 document:Pick<FormalDocument,'metadata'|'subject_key'|'subject_label'|'doc_type'>,
 capturedRole:unknown
):string{
 const role=typeof capturedRole==='string'?capturedRole.trim():'';
 if(role&&!TECHNICAL_ROLES.test(role))return role;
 const explicit=document.metadata?.signatory_title;
 if(typeof explicit==='string'&&explicit.trim()&&!TECHNICAL_ROLES.test(explicit.trim()))return explicit.trim();
 if(document.doc_type==='justice_response'||document.doc_type==='party_certificate'||document.subject_key==='minjust')
  return MINJUST_REGISTRATION_SIGNER_TITLE;
 const formal=FORMAL_SUBJECTS.find(item=>item.key===document.subject_key);
 if(formal)return formal.signatureTitle;
 const institution=String(document.metadata?.issuer_name||document.subject_label||'').trim();
 return institution?'Уполномоченное лицо — '+institution:'Уполномоченное должностное лицо';
}
