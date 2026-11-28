# Согласованность редакционных маршрутов компетенции — 28.11.2026

Исходный коммит: 3f417347f82ed61fdc908e7440a816b84002e39f. Матрица кандидатов: docs/EVENTS_V2_COMPETENCE_APPROVAL_CANDIDATE_2026-11-28.json (blob b5b40f7a58cb7d976dee299835727932a1a72856).

Проверены 141 индивидуальный кейс, 713 вариантов, соответствие ключей кейсов, названий, лучших ответов и предложенного профиля. Обнаружены 29 расхождений раннего поля `game_portfolio_candidate` с более поздней матрицей (включая новые предложения по ранее не распределённым сферам). Устранены только расхождения `office_key` / `office_title` черновой метаинформации. 112 записей не менялись. Исторические роли, юридические формулировки, лучшие ответы, источники, эффекты, оценки и флаги не изменены; обратное преобразование этих двух полей восстанавливает исходный JSON без других различий.

| Кейс | Ранний профиль | Актуальное предложение |
|---|---|---|
| bank-budget-bridge | ministry_defence | ministry_internal |
| bank-curated-light-07 | ministry_economic | ministry_internal |
| bank-curated-serious-06 | ministry_defence | ministry_economic |
| bank-curated-serious-07 | ministry_social | ministry_internal |
| bank-curated-serious-16 | ministry_defence | ministry_internal |
| bank-curated-serious-18 | ministry_social | ministry_economic |
| bank-curated-serious-20 | ministry_defence | ministry_internal |
| bank-curated-serious-21 | ministry_defence | ministry_internal |
| bank-curated-v2-07 | ministry_foreign | ministry_social |
| bank-curated-v2-08 | ministry_economic | ministry_internal |
| bank-curated-v2-10 | ministry_defence | ministry_internal |
| bank-curated-v2-13 | ministry_economic | ministry_social |
| bank-curated-v2-16 | ministry_defence | ministry_internal |
| bank-curated-v2-20 | ministry_foreign | ministry_economic |
| bank-curated-v2-30 | ministry_social | ministry_economic |
| bank-curated-v2-32 | ministry_defence | ministry_internal |
| bank-curated-v2-39 | ministry_social | ministry_internal |
| bank-curated-v2-46 | ministry_social | ministry_internal |
| bank-environment | ministry_economic | ministry_internal |
| bank-expanded-light-13-01 | ministry_internal | ministry_social |
| bank-expanded-light-15-01 | ministry_foreign | ministry_social |
| bank-expanded-light-18-01 | ministry_economic | ministry_social |
| bank-expanded-serious-06-01 | ministry_defence | ministry_internal |
| bank-expanded-serious-07-01 | ministry_defence | ministry_internal |
| bank-expanded-serious-10-01 | ministry_social | ministry_internal |
| bank-expanded-serious-14-01 | ministry_defence | ministry_internal |
| bank-expanded-serious-24-01 | ministry_defence | ministry_internal |
| bank-expanded-serious-27-01 | ministry_economic | ministry_social |
| bank-expanded-serious-28-01 | ministry_defence | ministry_internal |

Матрица остаётся предложением, не разрешением: 84 явно обозначенные сферы, 45 пересекающихся/выводимых и 12 ранее не распределённых; все 141 маршрута `activation_allowed=false`. Не назначать полномочия по этим метаданным. Проверка территориального соответствия и действующей должности обязательна при реализации.

Автономная проверка теперь сопоставляет все 141 записи с актуальной матрицей по ключу, названию, лучшему варианту и профилю; допуск закрыт при статусе неподтверждённого предложения. Изолированным JS проверены точные данные и отсутствие посторонних изменений. Полный Node/CI не запускался в этой сессии; база, RLS, API, UI и начисления не менялись, нагрузка на приложение не увеличилась. Шаг 4 открыт: юридическая приёмка, согласование маршрутов и числовых параметров остаются; шаг 5 не начат.
