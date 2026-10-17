const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
const file='components/game/ksrfVoteText.ts';
const mod=new Module(file,module);
mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const {formatKsrfVoteBody,uppercaseFirst}=mod.exports;
assert.equal(
 formatKsrfVoteBody('electoral_system','Система: proportional; метод распределения: sainte_lague. Обоснование: вот так должно быть.'),
 'Система: Пропорциональная. Метод распределения мандатов: Метод Сент-Лагю. Обоснование: Вот так должно быть.'
);
assert.equal(
 formatKsrfVoteBody('electoral_system','Система: mixed; формула: dhondt; мажоритарное правило: absolute_two_round; пропорциональная часть: 50%. Обоснование: мнение фракции'),
 'Система: Смешанная. Метод распределения мандатов: Метод Д’Ондта. Правило определения победителя: Абсолютное большинство, два тура. Доля пропорционального распределения: 50%. Обоснование: Мнение фракции.'
);
assert.equal(
 formatKsrfVoteBody('regional_system','Метод распределения 89 субъектов: proportional. Обоснование: распределить по мандатам'),
 'Способ распределения субъектов Российской Федерации: Пропорционально числу мандатов Государственной Думы. Обоснование: Распределить по мандатам.'
);
assert.equal(formatKsrfVoteBody('regional_system','Метод распределения 89 субъектов: random'),
 'Способ распределения субъектов Российской Федерации: Жеребьёвка.');
assert.equal(formatKsrfVoteBody('other','Система: proportional; формула: sainte_lague'),
 'Система: proportional; формула: sainte_lague','Do not rewrite unrelated or user-authored vote bodies');
assert.equal(uppercaseFirst('большинство от общего состава'),'Большинство от общего состава');
const votesView=fs.readFileSync('components/game/VotesView.tsx','utf8');
assert(votesView.includes('formatKsrfVoteBody(v.procedure_key,v.body)'));
assert(votesView.includes('uppercaseFirst(majorityLabel('));
assert(votesView.includes('Одна фракция — один голос'));
console.log('PASS: Russian election-system terms, majority format labels, legacy KSRF votes, unrelated votes unchanged');

assert.doesNotMatch(formatKsrfVoteBody('electoral_system','Система: unknown_internal_system'),/[A-Za-z_]/);
assert.doesNotMatch(formatKsrfVoteBody('electoral_system','Формула: toString'),/[A-Za-z_]/);
