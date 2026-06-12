// Session-log domain logic. Pure functions only — the log lives in
// chrome.storage.local under `log`, oldest first, one entry per credited
// run: { id, start, end, min, label, mode, completed }. Daily totals stay in
// `stats` (see core/stats.js); the log is what remembers *what* the time
// went to, so labels can be told apart later.

export const LOG_KEEP_DAYS = 366;
export const LOG_MAX_ENTRIES = 4000;

// Ids exist so single entries can be deleted from the dashboard. The end
// timestamp alone can collide (two runs banked in the same ms on import).
export function entryId(end = Date.now()) {
  return `${end.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Append keeping the log bounded — by age first, then a hard entry cap.
// Even heavy use stays a few hundred KB/year, well inside the storage quota.
export function appendEntry(log, entry) {
  const cutoff = entry.end - LOG_KEEP_DAYS * 86_400_000;
  const out = log.filter((e) => e.end >= cutoff);
  out.push(entry);
  return out.slice(-LOG_MAX_ENTRIES);
}

// Distinct labels, most recently used first — feeds the one-click chips.
export function recentLabels(log, n = 5) {
  const out = [];
  for (let i = log.length - 1; i >= 0 && out.length < n; i--) {
    const { label } = log[i];
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

// Minutes and completed pomodoro sessions per label since an epoch-ms
// instant, busiest first. Unlabelled work rides along as label null.
export function labelTotals(log, since) {
  const byLabel = new Map();
  for (const e of log) {
    if (e.end < since) continue;
    const label = e.label ?? null;
    const row = byLabel.get(label) ?? { label, min: 0, sessions: 0 };
    row.min += e.min;
    if (e.completed && e.mode === 'pomodoro') row.sessions += 1;
    byLabel.set(label, row);
  }
  return [...byLabel.values()].sort((a, b) => b.min - a.min);
}

export function removeEntry(log, id) {
  return log.filter((e) => e.id !== id);
}

// Renaming onto an existing label merges the two — totals are recomputed
// from entries, so nothing else needs to know.
export function renameLabel(log, from, to) {
  const next = String(to ?? '').trim().slice(0, 60);
  if (!next) return clearLabel(log, from);
  return log.map((e) => (e.label === from ? { ...e, label: next } : e));
}

// "Deleting" a label keeps the work, just unlabelled.
export function clearLabel(log, label) {
  return log.map((e) => (e.label === label ? { ...e, label: null } : e));
}

// Worked minutes by hour of day (24 buckets) since an epoch-ms instant.
// Long runs are split across the hours they actually spanned. Manual
// entries are skipped — their invented timestamps would pollute the shape.
export function hourHistogram(log, since) {
  const hours = new Array(24).fill(0);
  for (const e of log) {
    if (e.end < since || e.mode === 'manual' || e.min <= 0) continue;
    const span = e.end - e.start;
    if (span <= 0) {
      hours[new Date(e.end).getHours()] += e.min;
      continue;
    }
    let t = e.start;
    while (t < e.end) {
      const d = new Date(t);
      const hourEnd = new Date(d).setMinutes(60, 0, 0);
      const slice = Math.min(e.end, hourEnd) - t;
      hours[d.getHours()] += (e.min * slice) / span;
      t += slice;
    }
  }
  return hours.map(Math.round);
}

// Started vs finished focus runs — only the pomodoro cycle has a notion of
// completing; timers, stopwatch runs, and manual entries don't count.
export function completionStats(log, since) {
  let total = 0;
  let completed = 0;
  for (const e of log) {
    if (e.end < since || e.mode !== 'pomodoro') continue;
    total += 1;
    if (e.completed) completed += 1;
  }
  return { total, completed };
}
