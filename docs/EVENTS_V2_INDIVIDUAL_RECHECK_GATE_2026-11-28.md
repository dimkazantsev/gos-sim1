# Завершение повторного адресного разбора индивидуальных альтернатив — 28.11.2026

Срез 0eeb0976e90fa5d23a91e482606674b5f739569a. Три оставшихся кейса со статусом specific_articles_read_not_full_case_verification: 15 альтернатив. Уточнены 2 текста ответа; исторические сюжеты, URL, ключи, коэффициенты, роли, начисления и иные признаки сохранены. Состояние готовности: 141/141 индивидуальных адресных разборов, но не юридическая приёмка.

## bank-budget-bridge
257-ФЗ от 08.11.2007, ст. 30; 196-ФЗ, ст. 14; 68-ФЗ, ст. 11; 151-ФЗ, ст. 14, 26. Ограничение движения по категории дороги и информирование об объезде, компетенция по организации аварийно-спасательных работ, руководство ликвидацией ЧС и содействие спасателям.
Ограничение: Нормы проверены для учебного решения, а не как установление правовой оценки действий в апреле 2024 года. Категория дороги, уровень ЧС, региональные процедуры и правовое основание расходов требуют отдельного установления.
- https://www.consultant.ru/document/cons_doc_LAW_72386/d815e149e72342151144533709e7ebcf7aa60b8c/
- https://www.consultant.ru/document/cons_doc_LAW_8585/17c216cbd3011b1dc11ce6072fb90984cffcc9e4/
- https://www.consultant.ru/document/cons_doc_LAW_5295/cf148e8662eafdb9539fb6f19024dfdb5c33aaa2/
- https://www.consultant.ru/document/cons_doc_LAW_7746/5f9ee3efa7c5ed91f6750307819b88afa2cbcac0/
- https://www.consultant.ru/document/cons_doc_LAW_7746/b7a756f310958b28e741942fe0b0b049df899fd1/

## bank-budget-school
273-ФЗ от 29.12.2012, ст. 28 ч. 6 п. 2, ч. 7 и ст. 41 ч. 1 п. 8, ч. 2: безопасные условия обучения и охрана здоровья обучающихся; исполнение обязанностей образовательной организацией.
Ограничение: Технический акт об опасности является отдельно обозначенным учебным условием, не новым фактом исторического дела. Решение о ремонте и финансировании принимают компетентные лица по применимому порядку.
- https://www.consultant.ru/document/cons_doc_LAW_140174/552097cad5942f36c9484dbde7ebf92db1f783f3/
- https://www.consultant.ru/document/cons_doc_LAW_140174/48b9101fff215f3aeb122d86593a129a34d96d3c/

## bank-bus
220-ФЗ, ст. 14 ч. 1–3: регулярные перевозки по регулируемым тарифам организуются посредством государственного или муниципального контракта либо иных специально предусмотренных соглашений; в учебном условии выбран контракт.
Ограничение: Тариф и форма договора исторического маршрута не подтверждены первичным полным текстом. Конкретные полномочия и порядок изменения маршрута определяются региональным актом и контрактом. Опубликованное расписание не является доказательством исполнения.
- https://www.consultant.ru/document/cons_doc_LAW_182659/2a81d1737eb14693e515423a77157b0fb20088c8/

## Автономная проверка
14864 проверочных утверждений на полном каталоге (изолированный JavaScript с адаптером чтения точных файлов, не Node.js и не CI). Отрицательные пробы: выпуск отклонён (Legal/editorial release gate: unverified cases must never be activated); отсутствующее индивидуальное подтверждение отклонено (bank-budget-bridge individual recheck missing); расхождение реестра отклонено (bank-budget-bridge individual source evidence mismatch). Все пробы сделаны в памяти, не в базе данных. Результаты:

```json
{
  "reviewedIndividualCases": 141,
  "reviewedIndividualOptions": 713,
  "financialCases": 30,
  "checkedCofinancing": 16,
  "calibratedCases": 30,
  "calibratedOptions": 150
}
{
  "implementationReviewedCases": 189,
  "implementationReviewedOptions": 947,
  "extendedDominated": 0
}
{
  "individualRecheckCount": 141
}
{
  "collectiveReviewCount": 189,
  "collectiveReviewOptions": 947
}
{
  "cases": 330,
  "options": 1660,
  "individual": 141,
  "collective": 189,
  "longestCorrect": 34,
  "shortestCorrect": 30,
  "meanCorrectToOtherLength": 1.0013572736130667,
  "positions": {
    "1": 26,
    "2": 27,
    "3": 32,
    "4": 25,
    "5": 28,
    "6": 3
  },
  "unknownIndividualLawfulness": 0,
  "dominatedOptions": 128,
  "dominatedCases": 96,
  "activationBlocked": 330,
  "documentaryFull": 11,
  "documentaryIndexed": 2
}
{
  "registerActivationBlocked": 330
}
```

Шаг 4 не закрыт: все 330 остаются заблокированными; точные полномочия и экономические диапазоны требуют принятия владельцем, а адресный обзор — не независимая юридическая приёмка. Шаг 5 не начат. Нет изменений приложения, UI, RLS, SQL, исторических экземпляров, runtime-запросов или зависимостей. Браузер и нагрузка не проверялись. Только рабочая ветка, без слияния и намеренного production-развёртывания.
