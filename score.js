// Pure scoring logic. No DOM, no network — everything here is unit-tested.

export const WEIGHTS = { skill: 40, uni: 20, health: 20, fin: 5, eng: 5, mind: 5, refl: 5 };
export const DEFAULT_TARGETS = { skill: 240, uni: 120, health: 60, fin: 20, eng: 30, mind: 10 };
export const TIMED = ['skill', 'uni', 'health', 'fin', 'eng', 'mind'];

const filledCount = (...vals) => vals.filter(v => v && v.trim() !== '').length;

export function pillarPoints(key, data, targets) {
  if (key === 'refl') {
    const n = filledCount(data.win, data.reflect?.wrong, data.reflect?.tomorrow);
    return Math.round(WEIGHTS.refl * n / 3);
  }
  const target = targets[key];
  const mins = Math.min(data.minutes?.[key] ?? 0, target);
  if (key === 'health') return Math.round(15 * mins / target) + (data.sleep_ok ? 5 : 0);
  return Math.round(WEIGHTS[key] * mins / target);
}

export function dayPoints(data, targets) {
  const pts = {};
  for (const k of [...TIMED, 'refl']) pts[k] = pillarPoints(k, data, targets);
  return pts;
}

export function dayScore(points) {
  return Object.values(points).reduce((a, b) => a + b, 0);
}

export function dayStatus(score) {
  return score >= 80 ? 'green' : score >= 40 ? 'yellow' : 'red';
}

// ---- date helpers (local time; date strings are 'YYYY-MM-DD') ----

export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function prevDate(dateStr) {
  return addDays(dateStr, -1);
}

export function startOfWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return addDays(dateStr, -((d.getDay() + 6) % 7)); // Monday-based week
}

// ---- streak ----

export function streak(scoreByDate, todayStr) {
  let d = todayStr;
  if ((scoreByDate[d] ?? 0) < 40) d = prevDate(d); // today is still in progress
  let n = 0;
  while ((scoreByDate[d] ?? 0) >= 40) { n++; d = prevDate(d); }
  return n;
}
