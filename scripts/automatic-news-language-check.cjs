/* Regression: historical and new automatic news must render Russian statuses. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'components/game/automaticNewsLanguage.ts'),'utf8');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
vm.runInNewContext(js,{module:mod,exports:mod.exports});
const {localizeAutomaticNewsText:label,localizeAutomaticNewsTag:tag}=mod.exports;
const original='Основание: НПА: Свидетельство о регистрации политической партии «ЛДПР» → signed';
const translated=label(original);
assert.match(translated,/Основание: документ/);
assert.match(translated,/подписан/);
assert.doesNotMatch(translated,/\bsigned\b/);
assert.equal(original,'Основание: НПА: Свидетельство о регистрации политической партии «ЛДПР» → signed');
for(const [code,ru] of Object.entries({
 signed:'подписано',approved:'одобрено',rejected:'отклонено',published:'опубликовано',
 adopted:'принято',registered:'зарегистрировано',pending:'на рассмотрении',
 revision:'возвращено на доработку',submitted:'направлено на рассмотрение',
 completed:'завершено',open:'открыто',closed:'закрыто'
})){
 const result=label('Изменение → '+code);
 assert.ok(result.includes(ru),code+': '+result);
 assert.ok(!result.includes('→ '+code),code+' remains English');
}
assert.equal(label('Основание: НПА: Указ Президента → rejected'),'Основание: документ «Указ Президента» отклонён');
assert.equal(label('Статус документа: signed'),'Статус документа: подписано');
assert.equal(label('Политическая партия Goust Voting'),'Политическая партия Goust Voting');
assert.equal(tag('этап_gpyasu'),'этап');
assert.equal(tag('ходигры_gpyasu'),'ход_игры');
assert.equal(tag('сми_gpyasu'),'СМИ');
assert.equal(tag('партия_лдпр'),'партия_лдпр');
const wall=fs.readFileSync(path.join(root,'components/game/PoliticalWallView.tsx'),'utf8');
assert.ok(wall.includes('localizeAutomaticNewsText(editorialPost.body)'));
assert.ok(wall.includes('localizeAutomaticNewsText(editorialPost.title)'));
assert.ok(wall.includes('#{localizeAutomaticNewsTag(t)}'));
assert.ok(wall.includes("setSearch('#'+t)"),'Search continues to use the stored routing tag');
for(const name of ['правила','партии','президент','гд','сф','правительство','министерства','минюст','цик','цб','регионы','муниципалитет','выборы','мандаты','голосование','законопроект','нпа','госпрограмма','бюджет','налоги','контроль','кризис','итоги','рефлексия'])assert.doesNotMatch(tag(name+'_gpyasu'),/[A-Za-z]/);
assert.ok(wall.includes('const auto=!!p.source_key||p.context?.automatic===true'));
console.log('PASS: English statuses hidden in automatic news; stored content and user posts unchanged.');
