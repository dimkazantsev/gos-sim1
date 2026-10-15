'use client';
import type {FormalDocument} from './types';
import InstitutionEmblemImage from './InstitutionEmblemImage';
import {institutionEmblem} from './institutionEmblems';

const ruDate=(value:unknown,fallback:string)=>{
 const raw=typeof value==='string'&&value?value:fallback;
 const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T12:00:00+07:00':raw);
 return Number.isNaN(d.getTime())?'Дата не указана':new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Novosibirsk'}).format(d)+' г.';
};
export default function PartyCertificate({document:d}:{document:FormalDocument}){
 const m=d.metadata||{};
 const number=String(m.certificate_number||d.registry_no);
 const party=String(m.party_name||d.title.replace(/^Свидетельство о регистрации политической партии\s*/,''));
 const decision=ruDate(m.decision_date,d.created_at);
 const registered=ruDate(m.registry_date,d.created_at);
 const issued=ruDate(m.issue_date,d.created_at);
 const signer=String(m.signatory_name||'Казанцев Д.А.');
 const title=String(m.signatory_title||'Директор Департамента по делам некоммерческих организаций Министерства юстиции Российской Федерации');
 const address=typeof m.party_address==='string'&&m.party_address.trim()?m.party_address.trim():null;
 return <article className="partyOfficialCertificate" aria-label="Свидетельство о государственной регистрации политической партии">
   <header className="partyCertificateHeader">
    <InstitutionEmblemImage src={institutionEmblem('minjust','Министерство юстиции Российской Федерации')} width={88} height={96} alt="Эмблема Министерства юстиции Российской Федерации"/>
    <h2>МИНИСТЕРСТВО ЮСТИЦИИ РОССИЙСКОЙ ФЕДЕРАЦИИ</h2>
    <h3>СВИДЕТЕЛЬСТВО</h3>
    <strong>о государственной регистрации политической партии</strong>
   </header>
   <section className="partyCertificateText">
    <p className="partyCertificateParty">{party}</p>
    <small>(полное наименование политической партии)</small>
    {address&&<><p>{address}</p><small>(адрес (место нахождения) политической партии)</small></>}
    <p>Решение о государственной регистрации политической партии при создании принято {decision}</p>
    <p>Департамент по делам некоммерческих организаций Министерства юстиции Российской Федерации</p>
    <small>(наименование уполномоченного органа, принявшего решение о государственной регистрации)</small>
    <p>Запись о политической партии внесена в реестр политических партий ГОС.ID {registered} за регистрационным номером:</p>
    <div className="partyCertificateNumber">{number}</div>
    <p>{title}</p>
    <small>(должность уполномоченного лица органа, принявшего решение)</small>
   </section>
   <div className="partyCertificateSignature"><span>Подпись __________________</span><b>{signer}</b></div>
   <footer>Дата выдачи: {issued}<small>Свидетельство выдано в рамках цифровой политико-административной симуляции ГОС.ID. Не является записью государственного реестра Российской Федерации.</small></footer>
  </article>;
}
