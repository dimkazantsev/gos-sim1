/** Translate transport failures without exposing SQL or stack traces. */
export function userError(value:unknown):string{
 const s=typeof value==='string'?value:value&&typeof value==='object'&&'message' in value?String(value.message):'';
 const code=value&&typeof value==='object'&&'code' in value?String(value.code):'';
 const authErrors:Record<string,string>={
  email_exists:'Этот адрес уже зарегистрирован. Войдите с личным паролем или восстановите доступ к этому адресу. Для текущего профиля можно указать другую почту.',
  user_already_exists:'Этот адрес уже зарегистрирован. Войдите с личным паролем или восстановите доступ к этому адресу. Для текущего профиля можно указать другую почту.',
  over_email_send_rate_limit:'Слишком частая отправка писем. Подождите перед повторной отправкой. Если ограничение сохраняется, попробуйте позже.',
  email_address_not_authorized:'Почтовый сервис пока не разрешает отправку на этот адрес. Сообщите преподавателю: требуется настройка отправителя писем.',
  email_address_invalid:'Проверьте адрес электронной почты: укажите полный адрес без пробелов.',
  email_provider_disabled:'Отправка писем отключена. Сообщите преподавателю.',
 };
 if(Object.hasOwn(authErrors,code))return authErrors[code];
 if(!s)return '';
 const rules:[RegExp,string][]=[
 [/a user with this email address has already been registered|user already registered|email_exists|user_already_exists/i,authErrors.email_exists],
 [/email address not authorized/i,authErrors.email_address_not_authorized],
 [/over_email_send_rate_limit|for security purposes.*only request this after/i,authErrors.over_email_send_rate_limit],
 [/invalid login credentials/i,'Неверный адрес почты или пароль.'],[/email not confirmed/i,'Подтвердите адрес электронной почты.'],[/user already registered/i,'Этот адрес уже зарегистрирован. Войдите или восстановите пароль.'],[/rate limit|too many requests/i,'Слишком много запросов. Попробуйте немного позже.'],[/password.*(short|least|weak)/i,'Пароль слишком простой. Используйте не менее 8 символов.'],[/refresh token.*(context canceled|timeout|deadline)|context deadline exceeded|unexpected_failure/i,'Сервер авторизации временно не отвечает. Сеанс не удалён. Повторите попытку.'],
 [/jwt.*expired|session.*expired|refresh token/i,'Срок сеанса истёк. Войдите ещё раз.'],[/PGRST002|schema cache|could not query the database/i,'Сервис игровых данных временно недоступен. Повторите вход через несколько секунд.'],[/PGRST003|connection pool.*timed out/i,'Сервер игровых данных перегружен. Попробуйте войти немного позже.'],[/gateway timeout|HTTP 504|request timeout|service unavailable|HTTP 503/i,'Сервер временно не отвечает (503/504). Повторите попытку позднее.'],[/failed to fetch|network|load failed|timeout|timed out/i,'Нет ответа от сервера. Проверьте соединение и повторите попытку.'],[/row.level security|permission denied|not authorized|unauthorized|forbidden/i,'Для этого действия недостаточно прав.'],[/duplicate key|already exists/i,'Такая запись уже существует. Обновите данные.'],[/foreign key|violates.*constraint/i,'Проверьте связанные записи и заполненные поля.'],[/invalid input syntax|invalid.*(uuid|date|number)/i,'Проверьте формат даты, числа или выбранного объекта.'],[/bucket.*not found|object.*not found|resource.*not found/i,'Файл не найден. Обновите ссылку или загрузите его повторно.'],[/file.*(large|size)|payload too large/i,'Файл превышает допустимый размер.'],[/notallowederror|permission.*microphone|permission.*camera/i,'Разрешите доступ к микрофону или камере в настройках браузера.']
 ];
 for(const [pattern,text] of rules)if(pattern.test(s))return text;
 if(/^Candidate dossier is incomplete:\s*/i.test(s))return 'Пакет кандидата не готов к регистрации. '+userError(s.replace(/^Candidate dossier is incomplete:\s*/i,''));
 // A Cyrillic role name inside an English database exception must not bypass
 // localisation. Preserve messages written in Russian, not arbitrary mixtures.
 const visible=s.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+/gi,'').replace(/Goust Voting|ГОС\.ID|\b(?:PDF|DOCX?|TXT|XLSX|CSV|PNG|JPE?G|WEBP|ZIP|QR|HTTP|HTTPS)\b/gi,'');
 if(/^[\s«“"'\[\](\d:—-]*[а-яё]/i.test(s)&&!/(stack|SQLSTATE|syntax error|constraint)/i.test(s)&&!/[A-Za-z_]/.test(visible))return s;
 return 'Не удалось выполнить действие. Обновите данные и повторите попытку.';
}
