const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const exportsObject={};
const code=ts.transpileModule(fs.readFileSync('lib/userError.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
new Function('exports',code)(exportsObject);
const e=exportsObject.userError;
assert.equal(e({message:'Invalid login credentials'}),'Неверный адрес почты или пароль.');
for(const code of ['email_exists','user_already_exists']){
 assert.match(e({code,message:'Unfamiliar provider wording'}),/Этот адрес уже зарегистрирован/);
 assert.match(e({code,message:'Не удалось выполнить действие.'}),/восстановите доступ/);
}
assert.match(e({message:'A user with this email address has already been registered'}),/Этот адрес уже зарегистрирован/);
assert.match(e({code:'over_email_send_rate_limit',message:'For security purposes, you can only request this after 46 seconds.'}),/Слишком частая отправка писем/);
assert.match(e({message:'For security purposes, you can only request this after 13 seconds.'}),/Слишком частая отправка писем/);
assert.match(e({code:'email_address_not_authorized',message:'Hidden service message'}),/настройка отправителя/);
assert.match(e({message:'Email address not authorized'}),/настройка отправителя/);
assert.match(e({code:'email_address_invalid',message:'Invalid email'}),/Проверьте адрес/);
assert.equal(typeof e({code:'toString',message:'Unfamiliar failure'}),'string');
assert.equal(e(new Error('Failed to fetch')),'Нет ответа от сервера. Проверьте соединение и повторите попытку.');
assert.equal(e({message:'Allowed role is Министр финансов'}),'Не удалось выполнить действие. Обновите данные и повторите попытку.');
assert.equal(e({message:'Candidate dossier is incomplete: Не принят документ: согласие'}),'Пакет кандидата не готов к регистрации. Не принят документ: согласие');
assert.equal(e({message:'Не принят документ: согласие кандидата'}),'Не принят документ: согласие кандидата');
assert(!/[a-z]/i.test(e({message:'syntax error at SQLSTATE 42601'})));
console.log('PASS Russian login/network messages, mixed-language exceptions, candidate dossier context, no SQL traces');
