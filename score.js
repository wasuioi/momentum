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
  if (target == null) throw new Error(`pillarPoints: unknown key "${key}"`);
  const mins = Math.min(data.minutes?.[key] ?? 0, target);
  if (key === 'health') return Math.round(15 * mins / target) + (data.sleep_ok ? 5 : 0); // 20 max = 15 workout + 5 sleep
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

export function streak(scoreByDate, todayStr, forgiven = new Set()) {
  let d = todayStr;
  if ((scoreByDate[d] ?? 0) < 40) d = prevDate(d); // today is still in progress
  let n = 0;
  while (true) {
    if ((scoreByDate[d] ?? 0) >= 40) { n++; d = prevDate(d); continue; }
    if (forgiven.has(d)) { d = prevDate(d); continue; } // bridge a recovered break, don't count it
    break;
  }
  return n;
}

// ---- balance alert (spec §7): pillar earning < 50% of its max for >= 5
// consecutive days, counted back from yesterday. Missing days count as 0,
// but never look back before the earliest recorded day. Worst pillar wins. ----

export function balanceAlert(pointsByDate, yesterdayStr) {
  const dates = Object.keys(pointsByDate);
  if (dates.length === 0) return null;
  const earliest = dates.sort()[0];
  let worst = null;
  for (const k of Object.keys(WEIGHTS)) { // includes refl: skipping reflection 5 days also deserves a nudge
    let n = 0, d = yesterdayStr;
    while (d >= earliest && n < 60) { // cap lookback so sparse data can't loop forever
      const p = pointsByDate[d]?.[k] ?? 0;
      if (p >= WEIGHTS[k] / 2) break;
      n++; d = prevDate(d);
    }
    if (n >= 5 && (!worst || n > worst.days)) worst = { pillar: k, days: n };
  }
  return worst;
}

// ---- life trend (spec §7): last 30 days vs previous 30, % change of summed
// earned points per pillar; overall = % change of average daily score.
// rowsByDate: { 'YYYY-MM-DD': { points, score } } ----

export function lifeTrend(rowsByDate, todayStr) {
  const dates = [];
  let d = todayStr;
  for (let i = 0; i < 60; i++) { dates.unshift(d); d = prevDate(d); }
  const prevWin = dates.slice(0, 30), curWin = dates.slice(30);
  const hasPrev = prevWin.some(x => rowsByDate[x]);

  const out = { pillars: {}, overall: null };
  for (const k of Object.keys(WEIGHTS)) {
    const sum = win => win.reduce((a, x) => a + (rowsByDate[x]?.points?.[k] ?? 0), 0);
    const prev = sum(prevWin);
    out.pillars[k] = (!hasPrev || prev === 0) ? null : Math.round((sum(curWin) - prev) / prev * 100);
  }
  const avg = win => {
    const rows = win.filter(x => rowsByDate[x]);
    return rows.length ? rows.reduce((a, x) => a + rowsByDate[x].score, 0) / rows.length : 0;
  };
  const prevAvg = avg(prevWin);
  out.overall = (!hasPrev || prevAvg === 0) ? null : Math.round((avg(curWin) - prevAvg) / prevAvg * 100);
  return out;
}

// ---- timer helpers ----

export function elapsedMinutes(startedAtIso, nowMs) {
  return Math.max(0, Math.floor((nowMs - Date.parse(startedAtIso)) / 60000));
}

export function fmtElapsed(startedAtIso, nowMs) {
  const sec = Math.max(0, Math.floor((nowMs - Date.parse(startedAtIso)) / 1000));
  const h = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function bestStreak(scoreByDate, forgiven = new Set()) {
  const dates = Object.keys(scoreByDate).filter(d => scoreByDate[d] >= 40).sort();
  let best = 0, run = 0, prev = null;
  for (const d of dates) {
    if (prev === null) {
      run = 1;
    } else {
      // a run continues across a gap only if every day in the gap is forgiven (each adds 0)
      let g = prevDate(d), bridged = true;
      while (g > prev) { if (!forgiven.has(g)) { bridged = false; break; } g = prevDate(g); }
      run = (bridged && g === prev) ? run + 1 : 1;
    }
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// ---- streak recovery (spec: docs/superpowers/specs/2026-06-16-streak-recovery-design.md) ----

export const RECOVERY = { MIN_STREAK: 7, COOLDOWN_DAYS: 30, GREEN: 80, MAX_BREAK_AGE: 4 };

export function daysBetween(fromStr, toStr) {
  return Math.round((Date.parse(toStr + 'T00:00:00') - Date.parse(fromStr + 'T00:00:00')) / 86400000);
}

// window derived from the first broken day: [broken+1 00:00, broken+3 00:00)
export function recoveryWindowEndMs(brokenDate) {
  return Date.parse(addDays(brokenDate, 3) + 'T00:00:00');
}

export function recoveryEligibleDates(brokenDate) {
  return [addDays(brokenDate, 1), addDays(brokenDate, 2)];
}

export function fmtCountdown(endMs, nowMs) {
  const totalMin = Math.max(0, Math.floor((endMs - nowMs) / 60000));
  const h = Math.floor(totalMin / 60);
  return h > 0 ? `${h}h ${totalMin % 60}m` : `${totalMin % 60}m`;
}

// recovered broken_dates whose green day still scores >= GREEN (reverted/expired excluded; §6.3)
export function forgivenSet(history, scoreByDate) {
  const s = new Set();
  for (const h of history) {
    if (h.outcome === 'recovered' && (scoreByDate[h.recovered_date] ?? 0) >= RECOVERY.GREEN) {
      s.add(h.broken_date);
    }
  }
  return s;
}

const RECOVERY_CONDITION = { type: 'green_day', required: 1, min_score: RECOVERY.GREEN };

function isResolved(history, brokenDate) {
  return history.some(h => h.broken_date === brokenDate &&
    (h.outcome === 'recovered' || h.outcome === 'expired'));
}

function latestRecoveredDate(history) {
  let latest = null;
  for (const h of history) {
    if (h.outcome === 'recovered' && (!latest || h.recovered_date > latest)) latest = h.recovered_date;
  }
  return latest;
}

// Find the most recent break cluster and anchor to its EARLIEST day (the spec's
// "earliest unresolved broken day"), plus the streak it interrupted. A break is only
// actionable within MAX_BREAK_AGE days, so an old break followed by good days (organic
// recovery) is never surfaced as a stale failure.
function scanBreak(scoreByDate, todayStr, forgiven) {
  const recorded = Object.keys(scoreByDate);
  if (recorded.length === 0) return null;
  const earliest = recorded.sort()[0];
  const horizon = addDays(todayStr, -RECOVERY.MAX_BREAK_AGE);
  const broken = dt => (scoreByDate[dt] ?? 0) < 40 && !forgiven.has(dt);
  // most recent completed broken day within the horizon (skips good days after a break)
  let d = prevDate(todayStr);
  while (d >= earliest && d >= horizon && !broken(d)) d = prevDate(d);
  if (!(d >= earliest && d >= horizon && broken(d))) return null;
  // walk back to the earliest day of this contiguous broken cluster
  let b = d;
  while (b > earliest && broken(prevDate(b))) b = prevDate(b);
  return { firstBroken: b, protectedStreak: streak(scoreByDate, prevDate(b), forgiven) };
}

function resolveActive(state, active, history, scoreByDate, todayStr, nowMs, isNew) {
  const greenDate = recoveryEligibleDates(active.broken_date)
    .filter(dt => dt <= todayStr)
    .find(dt => (scoreByDate[dt] ?? 0) >= RECOVERY.GREEN);
  if (greenDate) {
    history.push({ outcome: 'recovered', broken_date: active.broken_date, recovered_date: greenDate,
      protected_streak: active.protected_streak, resolved_on: todayStr });
    return { next: { ...state, active: null, history }, event: 'success', changed: true,
      payload: { broken_date: active.broken_date, protected_streak: active.protected_streak } };
  }
  if (nowMs >= recoveryWindowEndMs(active.broken_date)) {
    history.push({ outcome: 'expired', broken_date: active.broken_date,
      protected_streak: active.protected_streak, resolved_on: todayStr });
    return { next: { ...state, active: null, history }, event: 'failure', changed: true,
      payload: { broken_date: active.broken_date, protected_streak: active.protected_streak } };
  }
  return { next: { ...state, active, history }, event: 'banner', changed: isNew,
    payload: { broken_date: active.broken_date, protected_streak: active.protected_streak,
      window_end_ms: recoveryWindowEndMs(active.broken_date) } };
}

export function evaluateRecovery(state, scoreByDate, todayStr, nowMs) {
  const history = state.history.map(h => ({ ...h }));      // clone; one controlled mutation allowed (§5)
  let active = state.active ? { ...state.active } : null;

  // STEP 1 — revoke the most recent recovery if its green day fell below 80 (§6.3)
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].outcome !== 'recovered') continue;
    const r = history[i];
    if ((scoreByDate[r.recovered_date] ?? 0) < RECOVERY.GREEN) {
      history[i] = { ...r, outcome: 'reverted', reverted_on: todayStr };
      if (nowMs < recoveryWindowEndMs(r.broken_date)) {     // window still open -> reopen
        active = { broken_date: r.broken_date, protected_streak: r.protected_streak, condition: RECOVERY_CONDITION };
        return { next: { ...state, active, history }, event: 'banner', changed: true,
          payload: { broken_date: r.broken_date, protected_streak: r.protected_streak,
            window_end_ms: recoveryWindowEndMs(r.broken_date) } };
      }
      history.push({ outcome: 'expired', broken_date: r.broken_date,             // window passed -> fail
        protected_streak: r.protected_streak, resolved_on: todayStr });
      return { next: { ...state, active: null, history }, event: 'failure', changed: true,
        payload: { broken_date: r.broken_date, protected_streak: r.protected_streak } };
    }
    break; // only the most recent recovered entry is reconciled
  }

  const forgiven = forgivenSet(history, scoreByDate);

  // STEP 2 — resolve an in-flight recovery
  if (active) return resolveActive(state, active, history, scoreByDate, todayStr, nowMs, false);

  // STEP 3 — detect a fresh break (dedupe + cooldown apply only here)
  const scan = scanBreak(scoreByDate, todayStr, forgiven);
  if (!scan || scan.protectedStreak < RECOVERY.MIN_STREAK) return { next: state, event: null, changed: false };
  if (isResolved(history, scan.firstBroken)) return { next: state, event: null, changed: false };
  const last = latestRecoveredDate(history);
  if (last && daysBetween(last, scan.firstBroken) < RECOVERY.COOLDOWN_DAYS)
    return { next: state, event: null, changed: false };
  const candidate = { broken_date: scan.firstBroken, protected_streak: scan.protectedStreak, condition: RECOVERY_CONDITION };
  return resolveActive(state, candidate, history, scoreByDate, todayStr, nowMs, true);
}
