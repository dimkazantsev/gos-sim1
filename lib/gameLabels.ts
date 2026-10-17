/** Captions for persisted system values. Database keys and authored text are not rewritten. */
const VALUE_LABELS:Record<string,string>={
 'Ghost voting':'Goust Voting','Ghost Voting':'Goust Voting','Goust Voting':'Goust Voting',
 locked:'Закрыто',running:'Игра идёт',paused:'Пауза',nomination:'Выдвижение',in_progress:'На рассмотрении',
 draft:'Черновик',submitted:'На рассмотрении',pending:'Ожидает решения',
 accepted:'Принято',approved:'Одобрено',adopted:'Принято',rejected:'Отклонено',
 revision:'На доработке',registered:'Зарегистрировано',published:'Опубликовано',
 signed:'Подписано',ready:'Готово',open:'Открыто',closed:'Завершено',
 completed:'Завершено',finished:'Завершено',resolved:'Разрешено',
 cancelled:'Отменено',archived:'В архиве',active:'Действует',inactive:'Не действует',
 withdrawn:'Отозвано',superseded:'Заменено новым решением',vote_open:'На голосовании',
 allocated:'Распределено',final:'Расчёт зафиксирован',document:'Проект зарегистрирован',
 requested:'Запрошено',granted:'Предоставлено',applied:'Применено',stale:'Устарело',
 paid:'Погашено',repaid:'Возвращено',due:'Наступил срок погашения',
 yes:'За',no:'Против',abstain:'Воздержался',passed:'Решение принято',no_quorum:'Нет кворума',
 low:'Низкая',medium:'Средняя',high:'Высокая',ultra:'Сверхвысокая',
 crisis:'Кризис',decision_accepted:'Принятое решение',formal_transition:'Движение документа',
 post_published:'Публикация',vote_closed:'Завершение голосования',
 event:'Ситуация',event_answers:'Решение ситуации',formal_history:'Действие с документом',
 political_post:'Публикация в политическом процессе',vote:'Голосование',
 party:'Партия',chat:'Сообщение в чате',navigation:'Переход между разделами',
 party_statistics_adjusted:'Корректировка статистики партии',login:'Вход в игру',
 profile_updated:'Изменение профиля',action_submitted:'Подача решения',
 vote_cast:'Подача голоса',document_created:'Создание документа',document_signed:'Подписание документа',
 manual:'Корректировка преподавателя',automatic:'Автоматически',baseline:'Исходное значение',
 act:'Нормативный акт',outcome:'Последствия ситуации',publication:'Опубликование закона',
 interest:'Начисление процентов',maturity:'Срок погашения',regional_maturity:'Срок возврата регионального кредита',
 transfer:'Перечисление трансферта',request:'Региональный запрос',amendment:'Бюджетная поправка',
 teacher:'Преподаватель',student:'Участник',observer:'Гость',guest:'Гость',
 participant:'Участник',system:'ГОС.ID',media:'СМИ',president:'Президент РФ',
 government:'Правительство РФ',gd:'Государственная Дума',sf:'Совет Федерации',
 ministry:'Министерство',municipality:'Муниципалитет',cec:'ЦИК РФ',ksrf:'КСРФ',
 region:'Регион',gd_deputy:'Депутат Государственной Думы',sf_member:'Сенатор РФ',
 ks:'Конституционный Суд РФ',vs:'Верховный Суд РФ',
 audio:'Аудиосообщение',video:'Видеосообщение',image:'Изображение',file:'Файл',text:'Текст',
 economy:'Экономика',security:'Безопасность',budget:'Доходы бюджета',
 elite_support:'Поддержка элит',public_trust:'Доверие граждан',
 social_stability:'Социальная стабильность',social_tension:'Социальное напряжение',
 lawfulness:'Правовая устойчивость',legitimacy:'Легитимность',
 international_standing:'Международное положение',media_climate:'Информационный фон',
 charter:'Устав партии',program:'Программа партии',symbol:'Символика партии',
 congress_minutes:'Протокол учредительного съезда',nomination_protocol:'Протокол выдвижения',
 consent:'Согласие баллотироваться',passport:'Документ, удостоверяющий личность',
 income:'Сведения о доходах',real_estate:'Сведения об имуществе',expenses:'Сведения о расходах',
 party_egrul:'Сведения о регистрации партии',group_petition:'Ходатайство группы избирателей',
 signature_sheets:'Подписные листы',government_vote:'Голосование Правительства',
 minister_review:'Рассмотрение министром',pm_review:'На подписи Председателя Правительства'
};
const VIEW_LABELS:Record<string,string>={
 dashboard:'Обзор игры',stages:'Этапы',parties:'Партии',votes:'Голосования',
 documents:'НПА',actions:'Политический процесс',grades:'Оценки',profile:'Профиль',
 teacher:'Управление',events:'События и решения',chat:'Командный чат',budget:'Бюджет'
};
export function gameValueLabel(value:string|null|undefined,fallback='Не указано'):string{
 if(!value)return fallback;
 if(Object.hasOwn(VALUE_LABELS,value))return VALUE_LABELS[value];
 return /[А-Яа-яЁё]/.test(value)&&!/[A-Za-z_]/.test(value)?value:fallback;
}
export function gameViewLabel(value:string|null|undefined):string{
 return value&&Object.hasOwn(VIEW_LABELS,value)?VIEW_LABELS[value]:'Раздел игры';
}
const CONDITION_LABELS:Record<string,string>={
 intensity:'Интенсивность',to_status:'Новая стадия документа',from_status:'Предыдущая стадия документа',
 actor_key:'Субъект',result_code:'Итог голосования',status:'Статус',doc_type:'Вид документа',
 process_type:'Вид публикации',source_type:'Источник',stage_no:'Этап',round_no:'Ход',
 action_type:'Вид действия',category:'Категория'
};
function conditionValue(value:unknown):string{
 if(Array.isArray(value))return value.map(conditionValue).join(', ');
 if(typeof value==='boolean')return value?'Да':'Нет';
 if(typeof value==='number')return Number.isFinite(value)?value.toLocaleString('ru-RU'):'Не указано';
 if(value&&typeof value==='object')return impactConditionText(value as Record<string,unknown>);
 return gameValueLabel(typeof value==='string'?value:null);
}
export function impactConditionText(conditions:Record<string,unknown>):string{
 return Object.entries(conditions).map(([key,value])=>
  (Object.hasOwn(CONDITION_LABELS,key)?CONDITION_LABELS[key]:'Дополнительное условие')+': '+conditionValue(value)
 ).join('\n');
}
