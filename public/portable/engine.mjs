/** Core event simulation used by both the standalone HTML and the LAN server. */
export function applyPortableAction(state, user, action, data) {
  const tables = state.tables;
  const table = name => tables[name] || [];
  const append = (name, row) => (tables[name] ??= []).push(row);
  const now = new Date().toISOString();
  const id = () => globalThis.crypto.randomUUID();
  const actions = ['metric', 'assign', 'vote', 'stage'];
  if (!actions.includes(action)) throw Error('Действие Не Поддерживается.');
  if (user?.kind !== 'teacher' && !(action === 'vote' && user?.kind === 'student')) {
    throw Error('Действие Доступно Преподавателю.');
  }
  const history = (metric, before, after, note) => {
    append('state_metric_history', {id: id(), game_id: state.game.id, metric_id: metric.id,
      metric_key: metric.metric_key, previous_value: before, value: after, delta: after - before,
      note, recorded_at: now});
    metric.previous_value = before;
    metric.value = after;
    metric.updated_at = now;
  };
  if (action === 'metric') {
    const metric = table('state_metrics').find(row => row.id === data.id);
    if (!metric || !Number.isFinite(Number(data.value))) throw Error('Некорректное Значение.');
    const before = Number(metric.value);
    const after = Math.min(metric.max_value ?? Infinity, Math.max(metric.min_value ?? -Infinity, Number(data.value)));
    const note = String(data.note || 'Корректировка Преподавателя').slice(0, 4000);
    history(metric, before, after, note);
    if (data.publish) append('political_posts', {id: id(), game_id: state.game.id,
      title: metric.label + ' · Изменение Показателя', body: note + '\nИзменение: ' + (after - before),
      actor_label: 'Руководитель Симуляции', status: 'published', created_at: now});
    return;
  }
  if (action === 'assign') {
    const event = table('event_cases').find(row => row.id === data.case_id && row.status === 'ready');
    const recipients = [...new Set(data.recipient_ids || (data.recipient_id ? [data.recipient_id] : []))];
    const members = table('game_members').filter(row => row.kind === 'student');
    if (!event || !recipients.length || recipients.some(id => !members.some(row => row.user_id === id))
        || table('event_case_outcomes').some(row => row.case_id === event.id)) {
      throw Error('Событие Или Участник Недоступны.');
    }
    const assigned = table('event_assignments').filter(row => row.case_id === event.id);
    if (table('event_decisions').some(row => row.case_id === event.id)) throw Error('Получатели Зафиксированы После Первого Голоса.');
    const combined = new Set([...assigned.map(row => row.recipient_id), ...recipients]);
    if (event.audience === 'single' && combined.size !== 1) throw Error('Выберите Одного Участника.');
    if (event.audience === 'group' && (combined.size < 2 || combined.size > 3)) throw Error('Выберите Двух Или Трёх Участников.');
    if (event.audience === 'all' && (combined.size !== members.length || members.some(row => !combined.has(row.user_id)))) {
      throw Error('Это Событие Назначается Всем Участникам.');
    }
    for (const recipient of recipients) {
      if (assigned.some(row => row.recipient_id === recipient)) continue;
      append('event_assignments', {id: id(), game_id: state.game.id, case_id: event.id,
        recipient_id: recipient, status: 'pending', created_at: now});
    }
    return;
  }
  if (action === 'stage') {
    const stage = table('game_stages').find(row => row.id === data.id);
    if (!stage || data.status !== 'open') throw Error('Этап Не Найден Или Статус Недоступен.');
    stage.status = 'open';
    state.game.current_round = stage.stage_no;
    return;
  }
  const assignment = table('event_assignments').find(row => row.id === data.assignment_id && row.recipient_id === user.id);
  const event = assignment && table('event_cases').find(row => row.id === assignment.case_id);
  const choices = event?.decision_options;
  if (!assignment || assignment.status !== 'pending' || !event || !Array.isArray(choices)
      || !Number.isInteger(data.index) || data.index < 0 || data.index >= choices.length) {
    throw Error('Это Голосование Вам Недоступно.');
  }
  if (table('event_case_outcomes').some(row => row.case_id === event.id)) throw Error('Голосование Завершено.');
  append('event_decisions', {id: id(), game_id: state.game.id, assignment_id: assignment.id,
    case_id: event.id, actor_id: user.id, choice: 'option_' + (data.index + 1), created_at: now});
  assignment.status = 'resolved';
  const assigned = table('event_assignments').filter(row => row.case_id === event.id);
  if (assigned.some(row => row.status === 'pending')) return;
  const votes = table('event_decisions').filter(row => row.case_id === event.id);
  const counts = choices.map((_, index) => votes.filter(vote => vote.choice === 'option_' + (index + 1)
    || (index === 0 && vote.choice === 'accept') || (index === 1 && vote.choice === 'reject')).length);
  const best = Math.max(...counts);
  const winners = counts.map((count, index) => count === best ? index : -1).filter(index => index >= 0);
  const index = winners.length === 1 ? winners[0] : -1;
  const metric = table('state_metrics').find(row => row.metric_key === 'public_trust');
  const requested = index < 0 ? 0 : Number(event.effect_plan?.options?.[index]?.trust || 0);
  const before = Number(metric?.value || 0);
  const after = metric ? Math.min(metric.max_value ?? 100, Math.max(metric.min_value ?? 0, before + requested)) : before;
  const actual = after - before;
  if (metric) history(metric, before, after, 'Итог События: ' + event.title);
  const label = index < 0 ? 'Равное Число Голосов' : choices[index];
  append('event_case_outcomes', {case_id: event.id, game_id: state.game.id,
    winner: index < 0 ? 'tie' : 'option_' + (index + 1), trust_delta: actual,
    requested_trust_delta: requested, resolution_kind: requested > 0 ? 'beneficial' : requested < 0 ? 'harmful' : 'neutral',
    option_tallies: choices.map((label, idx) => ({key: 'option_' + (idx + 1), label, votes: counts[idx]})),
    votes_count: votes.length, assignments_count: assigned.length, resolved_at: now});
  append('event_trust_ledger', {id: id(), game_id: state.game.id, action_key: 'choice-' + event.id,
    delta: actual, note: event.title, created_at: now});
  append('political_posts', {id: id(), game_id: state.game.id, title: event.title + ' · Итог Решения',
    body: (event.comic_scene?.news_lead || event.situation) + '\n\nПринято: ' + label + '\n'
      + (event.effect_plan?.options?.[index]?.description || 'Общее Решение Не Определено.')
      + '\nИзменение Доверия: ' + actual + ' П.п.',
    actor_label: event.comic_scene?.media_label || 'СМИ · ' + event.category,
    comic_scene: event.comic_scene, status: 'published', created_at: now});
}
