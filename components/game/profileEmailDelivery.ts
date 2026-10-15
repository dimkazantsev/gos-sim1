/** Map Supabase Auth failures without retrying rejected email requests. */
export type ProfileEmailAuthError={code?:string|null;status?:number|null;message?:string|null};
export type ProfileEmailFailure={kind:'rate_limit'|'email_exists'|'not_authorized'|'other';notice:string;cooldownMs:number};
export const EMAIL_RATE_LIMIT_COOLDOWN_MS=60*60*1000;
export const EMAIL_RESEND_GUARD_MS=60*1000;

export function describeProfileEmailError(error:ProfileEmailAuthError):ProfileEmailFailure {
 const code=(error.code||'').toLowerCase();
 const message=(error.message||'').toLowerCase();
 if(code==='email_exists'||message.includes('already been registered')||message.includes('already registered')){
  return {kind:'email_exists',cooldownMs:0,
   notice:'Этот адрес уже зарегистрирован в системе авторизации. Повторная отправка не поможет. Используйте другой адрес либо восстановите доступ к существующей учётной записи. Не выходите из текущей игровой сессии, пока не определитесь со способом входа.'};
 }
 if(error.status===429||code==='over_email_send_rate_limit'||code==='over_request_rate_limit'||message.includes('too many requests')){
  return {kind:'rate_limit',cooldownMs:EMAIL_RATE_LIMIT_COOLDOWN_MS,
   notice:'Сервис авторизации временно ограничил отправку писем. Лимит действует на проект, поэтому десять немедленных повторов не помогут. Повторная отправка будет доступна после защитной паузы около часа; точное время снятия ограничения определяет Supabase. Если письмо уже получено, перейдите по ссылке и нажмите «Проверить подтверждение» — новое письмо для этого не нужно.'};
 }
 if(code==='email_address_not_authorized'||message.includes('email address not authorized')){
  return {kind:'not_authorized',cooldownMs:0,
   notice:'Почтовый сервис Supabase не разрешает отправку на этот адрес. Для рассылки всем участникам требуется настроить собственный SMTP-сервис в Supabase Auth.'};
 }
 return {kind:'other',cooldownMs:0,notice:'Не удалось отправить письмо: '+(error.message||'Неизвестная ошибка сервиса авторизации.')};
}
