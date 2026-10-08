export type StateProgram={id:string;game_id:string;title:string;responsible_ministry:string;responsible_minister_id:string|null;curator_id:string|null;national_goal:string|null;presidential_priority_id:string|null;participants:string|null;start_date:string|null;end_date:string|null;total_budget:number;expected_results:string|null;status:'draft'|'minister_review'|'revision'|'pm_review'|'ready'|'government_vote'|'adopted'|'rejected';government_vote_id:string|null;created_by:string;created_at:string;updated_at:string;form_version?:number;signed_by?:string|null;signed_at?:string|null;publication_post_id?:string|null};
export type ProgramGoal={id:string;program_id:string;goal_text:string;indicator_name:string;unit:string|null;baseline_value:number|null;target_value:number|null;target_year:number|null};
export type ProgramComponent={id:string;program_id:string;direction_no:number;direction_title:string;component_kind:'project'|'target_program'|'measure';title:string;goal_text:string;start_date:string|null;end_date:string|null;budget:number};
export type ProgramExpense={id:string;program_id:string;component_id:string;indicator_name:string;justification:string;budget_year:number;amount:number;position:number};
export type ProgramPriority={id:string;address_id:string;game_id:string;priority_no:number;title:string;description:string|null;national_goal:string|null;created_at:string};
export const programStatusLabel:Record<StateProgram['status'],string>={draft:'Черновик',minister_review:'У министра',revision:'Доработка',pm_review:'На подписи Председателя Правительства',ready:'Подписана · Готова к заседанию',government_vote:'Голосование Правительства',adopted:'Принята Правительством',rejected:'Отклонена'};
export const nationalGoals=[
 'Сохранение населения, укрепление здоровья и повышение благополучия людей, поддержка семьи',
 'Реализация потенциала каждого человека, развитие его талантов, воспитание патриотичной и социально ответственной личности',
 'Комфортная и безопасная среда для жизни',
 'Экологическое благополучие',
 'Устойчивая и динамичная экономика',
 'Технологическое лидерство',
 'Цифровая трансформация государственного и муниципального управления, экономики и социальной сферы'
];
export const programMoney=(value:number|string)=>Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
// Keep the displayed total exact to the kopeck; the server independently validates it.
export function expenseKopecks(value:string):bigint|null{
 const normalized=value.trim().replace(',','.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(normalized))return null;
 const [rubles,fraction='']=normalized.split('.');
 return BigInt(rubles)*100n+BigInt(fraction.padEnd(2,'0'));
}
export function kopecksMoney(value:bigint):string{return (value/100n).toLocaleString('ru-RU')+','+(value%100n).toString().padStart(2,'0')+' ₽'}
