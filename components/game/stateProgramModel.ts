export type StateProgram={id:string;game_id:string;title:string;responsible_ministry:string;responsible_minister_id:string|null;curator_id:string|null;national_goal:string|null;presidential_priority_id:string|null;participants:string|null;start_date:string|null;end_date:string|null;total_budget:number|string;expected_results:string|null;status:'draft'|'minister_review'|'revision'|'pm_review'|'ready'|'government_vote'|'adopted'|'rejected';government_vote_id:string|null;created_by:string;created_at:string;updated_at:string;form_version?:number;signed_by?:string|null;signed_at?:string|null;publication_post_id?:string|null};
export type ProgramGoal={id:string;program_id:string;goal_text:string;indicator_name:string;unit:string|null;baseline_value:number|null;target_value:number|null;target_year:number|null};
export type ProgramComponent={id:string;program_id:string;direction_no:number;direction_title:string;component_kind:'project'|'target_program'|'measure';title:string;goal_text:string;start_date:string|null;end_date:string|null;budget:number|string};
export type ProgramExpense={id:string;program_id:string;component_id:string;indicator_name:string;justification:string;budget_year:number;amount:number|string;position:number};
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
export function programMoney(value:number|string):string{
 const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
 if(!match)return '—';
 const fraction=match[3]||'';
 const cents=BigInt(match[2])*100n+BigInt(fraction.padEnd(2,'0').slice(0,2))+(Number(fraction[2]||0)>=5?1n:0n);
 return kopecksMoney(match[1]? -cents:cents);
}
// Keep the displayed total exact to the kopeck; the server independently validates it.
export function expenseKopecks(value:string):bigint|null{
 const normalized=value.trim().replace(',','.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(normalized))return null;
 const [rubles,fraction='']=normalized.split('.');
 return BigInt(rubles)*100n+BigInt(fraction.padEnd(2,'0'));
}
export function kopecksMoney(value:bigint):string{const absolute=value<0n?-value:value;return (value<0n?'−':'')+(absolute/100n).toLocaleString('ru-RU')+','+(absolute%100n).toString().padStart(2,'0')+' ₽'}
