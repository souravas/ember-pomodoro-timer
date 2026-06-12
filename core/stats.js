// Stats domain logic. Pure functions only — daily totals live in
// chrome.storage.local under `stats`, keyed YYYY-MM-DD (local time) with
// { sessions, minutes }; everything here only reads that shape.

import { todayKey } from './timer.js';

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// The most recent `weekStart` day (0 sun, 1 mon, 6 sat) at midnight —
// where "this week" begins is a setting, not a fact.
export function startOfWeek(date, weekStart = 1) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return addDays(d, -((d.getDay() - weekStart + 7) % 7));
}

// YYYY-MM-DD → local Date. (new Date('YYYY-MM-DD') would parse as UTC.)
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function minutesOn(stats, key) {
  return stats[key]?.minutes ?? 0;
}

// "0m", "45m", "3h", "3h 05m"
export function formatHours(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

// Compact form for chart labels: "45m", "2h", "2.5h"
export function formatHoursShort(min) {
  if (min < 60) return `${min}m`;
  return `${Math.round(min / 6) / 10}h`;
}

// The last `days` days ending at `end`, oldest first.
export function daySeries(stats, days, end = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(end, -i);
    const key = todayKey(date);
    out.push({ date, key, minutes: minutesOn(stats, key) });
  }
  return out;
}

// The current calendar week, oldest first — days still to come ride along
// so the week chart keeps a stable shape.
export function weekDays(stats, weekStart = 1, now = new Date()) {
  return daySeries(stats, 7, addDays(startOfWeek(now, weekStart), 6));
}

// Weekly totals for the last `weeks` weeks ending in the current one,
// oldest first; each entry's date is the day the week starts on.
export function weekSeries(stats, weeks, weekStart = 1, now = new Date()) {
  const out = [];
  const thisWeek = startOfWeek(now, weekStart);
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i);
    let minutes = 0;
    for (let d = 0; d < 7; d++) minutes += minutesOn(stats, todayKey(addDays(start, d)));
    out.push({ date: start, minutes });
  }
  return out;
}

// Headline numbers for the stat cards.
export function summary(stats, weekStart = 1, now = new Date()) {
  const today = stats[todayKey(now)] ?? { sessions: 0, minutes: 0 };

  let weekMin = 0;
  const weekFrom = startOfWeek(now, weekStart);
  for (let d = 0; d < 7; d++) weekMin += minutesOn(stats, todayKey(addDays(weekFrom, d)));

  let totalMin = 0;
  let totalSessions = 0;
  let bestDay = null;
  for (const [key, day] of Object.entries(stats)) {
    totalMin += day.minutes ?? 0;
    totalSessions += day.sessions ?? 0;
    if (day.minutes > 0 && (!bestDay || day.minutes > bestDay.minutes)) {
      bestDay = { key, minutes: day.minutes };
    }
  }

  // Streak: consecutive days with any credited work. A quiet today doesn't
  // break a run that's alive through yesterday.
  let streak = 0;
  let cursor = minutesOn(stats, todayKey(now)) > 0 ? now : addDays(now, -1);
  while (minutesOn(stats, todayKey(cursor)) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return { today, weekMin, streak, bestStreak: bestStreak(stats), bestDay, totalMin, totalSessions };
}

// Longest run of consecutive active days anywhere in history.
export function bestStreak(stats) {
  const keys = Object.keys(stats)
    .filter((k) => minutesOn(stats, k) > 0)
    .sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of keys) {
    run = prev && todayKey(addDays(parseKey(prev), 1)) === key ? run + 1 : 1;
    if (run > best) best = run;
    prev = key;
  }
  return best;
}

// Heatmap intensity, 0..4. Anchored to 25-minute sessions: one session
// lights the cell, a deep-work day saturates it.
export function heatLevel(minutes) {
  if (minutes <= 0) return 0;
  if (minutes < 50) return 1;
  if (minutes < 100) return 2;
  if (minutes < 200) return 3;
  return 4;
}

// Cells for a GitHub-style year grid: every day from the week-start day
// 52 weeks back through today, oldest first. The renderer flows them
// column-wise, so starting the series on that day keeps the rows aligned.
export function heatmapDays(stats, weekStart = 1, now = new Date()) {
  const start = startOfWeek(addDays(now, -364), weekStart);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  // Round over DST: a day is not always exactly 24h of wall time.
  const days = Math.round((end - start) / 86_400_000) + 1;
  return daySeries(stats, days, now);
}
