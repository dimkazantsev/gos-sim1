/** Visible political-process feed only. Does not change stored posts, order or filters. */
export const POLITICAL_POST_BATCH_SIZE = 10;

export function visiblePoliticalPostCount(total: number, requested = POLITICAL_POST_BATCH_SIZE): number {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeRequested = Number.isFinite(requested)
    ? Math.max(POLITICAL_POST_BATCH_SIZE, Math.trunc(requested))
    : POLITICAL_POST_BATCH_SIZE;
  return Math.min(safeTotal, safeRequested);
}

export function nextPoliticalPostCount(current: number, total: number): number {
  return visiblePoliticalPostCount(total, current + POLITICAL_POST_BATCH_SIZE);
}
