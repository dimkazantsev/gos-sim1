/** Translate transport failures without exposing SQL or stack traces. */
export function userError(value:unknown):string{
 const s=typeof value==='string'?value:value&&typeof value==='object'&&'message' in value?String(value.message):'';
 if(!s)return '';
 const rules:[RegExp,string][]=[
 [/invalid login credentials/i,'Неверный адрес почты или пароль.'],[/email not confirmed/i,'Подтвердите адрес электронной почты.'],[/user already registered/i,'Этот адрес уже зарегистрирован. Войдите или восстановите пароль.'],[/rate limit|too many requests/i,'Слишком много запросов. Попробуйте немного позже.'],[/password.*(short|least|weak)/i,'Пароль слишком простой. Используйте не менее 8 символов.'],[/jwt.*expired|session.*expired|refresh token/i,'Срок сеанса истёк. Войдите ещё раз.'],[/failed to fetch|network|load failed|timeout|timed out/i,'Нет ответа от сервера. Проверьте соединение и повторите попытку.'],[/row.level security|permission denied|not authorized|unauthorized|forbidden/i,'Для этого действия недостаточно прав.'],[/duplicate key|already exists/i,'Такая запись уже существует. Обновите данные.'],[/foreign key|violates.*constraint/i,'Проверьте связанные записи и заполненные поля.'],[/invalid input syntax|invalid.*(uuid|date|number)/i,'Проверьте формат даты, числа или выбранного объекта.'],[/bucket.*not found|object.*not found|resource.*not found/i,'Файл не найден. Обновите ссылку или загрузите его повторно.'],[/file.*(large|size)|payload too large/i,'Файл превышает допустимый размер.'],[/notallowederror|permission.*microphone|permission.*camera/i,'Разрешите доступ к микрофону или камере в настройках браузера.']
 ];
 for(const [pattern,text] of rules)if(pattern.test(s))return text;
 if(/[а-яё]/i.test(s)&&!/(stack|SQLSTATE|syntax error|constraint)/i.test(s))return s;
 return 'Не удалось выполнить действие. Обновите данные и повторите попытку.';
}
