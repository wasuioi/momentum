# Momentum Life Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Momentum life-dashboard web app per the approved spec at `docs/superpowers/specs/2026-06-12-momentum-life-dashboard-design.md`.

**Architecture:** Static vanilla-JS web app (no build step, no framework). Pure scoring logic in `score.js` (unit-tested with `node --test`), Supabase for auth + storage via `db.js`, single `app.js` for UI rendering with hash routing. Visual design is already locked in `design/` mockups — `style.css` consolidates those styles.

**Tech Stack:** HTML/CSS/ES modules, Supabase JS v2 (CDN ESM), node:test for unit tests, GitHub Pages for hosting.

**Worktree:** Execute this plan inside an isolated worktree (`EnterWorktree` / superpowers:using-git-worktrees). `git fetch origin` first if a remote exists (currently local-only repo).

**Reference mockups (committed, open in browser to compare):**
- `design/screens/today-mobile.html`, `design/screens/today-desktop.html`
- `design/screens/week-mobile.html`, `design/screens/month-mobile.html`
- `design/foundation/design-system.html`

---

## File Structure

```
index.html          — app shell: login overlay, nav, empty <main>, error banner
style.css           — all styles (tokens + components, consolidated from mockups)
app.js              — boot, auth, routing, rendering, events, timer integration
score.js            — PURE functions: scoring, status, streak, alert, trend, date/time helpers
db.js               — Supabase client + typed data access (throws on every error)
config.js           — SUPABASE_URL / SUPABASE_ANON_KEY (anon key is public by design)
setup.sql           — tables + RLS policies (paste into Supabase SQL editor)
manifest.json       — PWA manifest (Add to Home Screen)
icon.svg            — app icon
tests/score.test.js — unit tests for score.js
```

Data shapes (from spec §5): a day's `data` jsonb is
`{minutes:{skill,uni,health,fin,eng,mind}, tags:{pillar:[ids]}, sleep_ok:bool, notes:{pillar:text}, win:text, reflect:{wrong,tomorrow}, points:{...}}`.
`app_state` rows: `timer` `{pillar,started_at}|null`, `targets` `{skill:240,...}`, `mission` `{title,deadline,progress}|null`.

---

### Task 1: Scaffold

**Files:**
- Create: `.gitignore`, `config.js`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
.DS_Store
```

- [ ] **Step 2: Create `config.js`** (placeholders — real values added by the user in Task 13)

```js
// Supabase project credentials. The anon key is a PUBLIC key by design;
// data is protected by Auth + RLS, not by hiding this key.
export const SUPABASE_URL = 'PASTE_YOUR_SUPABASE_URL';
export const SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_KEY';
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore config.js
git commit -m "chore: scaffold config and gitignore"
```

---

### Task 2: score.js — constants + daily scoring (TDD)

**Files:**
- Create: `score.js`
- Test: `tests/score.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/score.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEIGHTS, DEFAULT_TARGETS, pillarPoints, dayPoints, dayScore, dayStatus,
} from '../score.js';

const T = { ...DEFAULT_TARGETS }; // {skill:240, uni:120, health:60, fin:20, eng:30, mind:10}

test('weights sum to 100', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('timed pillar points: proportional, rounded, capped at target', () => {
  assert.equal(pillarPoints('skill', { minutes: { skill: 210 } }, T), 35); // 210/240*40
  assert.equal(pillarPoints('skill', { minutes: { skill: 0 } }, T), 0);
  assert.equal(pillarPoints('skill', { minutes: {} }, T), 0);              // missing = 0
  assert.equal(pillarPoints('skill', { minutes: { skill: 300 } }, T), 40); // over target capped
  assert.equal(pillarPoints('uni', { minutes: { uni: 90 } }, T), 15);      // 90/120*20
  assert.equal(pillarPoints('eng', { minutes: { eng: 25 } }, T), 4);       // 4.166 -> 4
  assert.equal(pillarPoints('mind', { minutes: { mind: 10 } }, T), 5);
});

test('health: 15 pts from workout minutes + 5 pts sleep', () => {
  assert.equal(pillarPoints('health', { minutes: { health: 45 }, sleep_ok: false }, T), 11); // 11.25 -> 11
  assert.equal(pillarPoints('health', { minutes: { health: 60 }, sleep_ok: true }, T), 20);
  assert.equal(pillarPoints('health', { minutes: {}, sleep_ok: true }, T), 5);
});

test('reflection: 5 pts across win + 2 questions', () => {
  const d = (win, wrong, tomorrow) => ({ win, reflect: { wrong, tomorrow } });
  assert.equal(pillarPoints('refl', d('', '', ''), T), 0);
  assert.equal(pillarPoints('refl', d('a', '', ''), T), 2);   // round(5/3)
  assert.equal(pillarPoints('refl', d('a', 'b', ''), T), 3);  // round(10/3)
  assert.equal(pillarPoints('refl', d('a', 'b', 'c'), T), 5);
  assert.equal(pillarPoints('refl', d('  ', 'b', ''), T), 2); // whitespace-only = empty
});

test('dayPoints + dayScore reproduce the approved mockup day = 80', () => {
  const data = {
    minutes: { skill: 210, uni: 90, health: 45, fin: 20, eng: 25, mind: 10 },
    sleep_ok: false,
    win: 'Shipped the auth flow',
    reflect: { wrong: 'Slept late', tomorrow: 'Finish problem set' },
  };
  const pts = dayPoints(data, T);
  assert.deepEqual(pts, { skill: 35, uni: 15, health: 11, fin: 5, eng: 4, mind: 5, refl: 5 });
  assert.equal(dayScore(pts), 80);
});

test('dayStatus thresholds', () => {
  assert.equal(dayStatus(80), 'green');
  assert.equal(dayStatus(79), 'yellow');
  assert.equal(dayStatus(40), 'yellow');
  assert.equal(dayStatus(39), 'red');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module ... score.js`

- [ ] **Step 3: Write the implementation**

Create `score.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add score.js tests/score.test.js
git commit -m "feat: daily scoring rules (pillar points, day score, status)"
```

---

### Task 3: score.js — date helpers + streak (TDD)

**Files:**
- Modify: `score.js` (append)
- Test: `tests/score.test.js` (append)

- [ ] **Step 1: Append failing tests to `tests/score.test.js`**

Add to the import list: `toDateStr, prevDate, addDays, startOfWeek, streak`

```js
test('date helpers', () => {
  assert.equal(toDateStr(new Date(2026, 5, 12)), '2026-06-12'); // month is 0-based
  assert.equal(prevDate('2026-06-01'), '2026-05-31');
  assert.equal(addDays('2026-06-12', -35), '2026-05-08');
  assert.equal(addDays('2026-06-12', 2), '2026-06-14');
  assert.equal(startOfWeek('2026-06-12'), '2026-06-08'); // Fri -> Monday
  assert.equal(startOfWeek('2026-06-08'), '2026-06-08'); // Monday stays
});

test('streak counts consecutive days >= 40 back from today', () => {
  const s = { '2026-06-12': 80, '2026-06-11': 45, '2026-06-10': 90 };
  assert.equal(streak(s, '2026-06-12'), 3);
});

test('streak: today below 40 does not break it (day not finished)', () => {
  const s = { '2026-06-12': 10, '2026-06-11': 45, '2026-06-10': 90 };
  assert.equal(streak(s, '2026-06-12'), 2);
});

test('streak: red day or missing day breaks it', () => {
  assert.equal(streak({ '2026-06-12': 80, '2026-06-11': 20, '2026-06-10': 90 }, '2026-06-12'), 1);
  assert.equal(streak({ '2026-06-12': 80, '2026-06-10': 90 }, '2026-06-12'), 1);
  assert.equal(streak({}, '2026-06-12'), 0);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: new tests FAIL (`toDateStr is not a function` style errors), old tests PASS

- [ ] **Step 3: Append implementation to `score.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add score.js tests/score.test.js
git commit -m "feat: date helpers and streak calculation"
```

---

### Task 4: score.js — balance alert + life trend (TDD)

**Files:**
- Modify: `score.js` (append)
- Test: `tests/score.test.js` (append)

- [ ] **Step 1: Append failing tests to `tests/score.test.js`**

Add to the import list: `balanceAlert, lifeTrend`

```js
// helper: build {date: pointsObj} for n consecutive days ending at `end`
function pointsRun(end, n, pointsObj) {
  const out = {};
  let d = end;
  for (let i = 0; i < n; i++) { out[d] = pointsObj; d = prevDate(d); }
  return out;
}

test('balanceAlert: fires at 5 consecutive below-50% days, not at 4', () => {
  const good = { skill: 40, uni: 20, health: 20, fin: 5, eng: 5, mind: 5, refl: 5 };
  const noEng = { ...good, eng: 1 }; // eng below 2.5 (50% of 5)
  const four = { ...pointsRun('2026-06-11', 4, noEng), ...pointsRun('2026-06-07', 10, good) };
  assert.equal(balanceAlert(four, '2026-06-11'), null);
  const five = { ...pointsRun('2026-06-11', 5, noEng), ...pointsRun('2026-06-06', 10, good) };
  assert.deepEqual(balanceAlert(five, '2026-06-11'), { pillar: 'eng', days: 5 });
});

test('balanceAlert: picks the pillar with the longest miss run', () => {
  const good = { skill: 40, uni: 20, health: 20, fin: 5, eng: 5, mind: 5, refl: 5 };
  const missEng = { ...good, eng: 0 };
  const missBoth = { ...good, eng: 0, mind: 0 };
  const rows = { ...pointsRun('2026-06-11', 6, missBoth), ...pointsRun('2026-06-05', 3, missEng), ...pointsRun('2026-06-02', 5, good) };
  assert.deepEqual(balanceAlert(rows, '2026-06-11'), { pillar: 'eng', days: 9 });
});

test('balanceAlert: missing days count as 0 but never before first recorded day', () => {
  const good = { skill: 40, uni: 20, health: 20, fin: 5, eng: 5, mind: 5, refl: 5 };
  assert.equal(balanceAlert({}, '2026-06-11'), null); // brand-new user
  // recorded 2026-06-10 only; 11th missing -> counts as 0, but run stops at earliest record
  const rows = { '2026-06-10': good };
  assert.equal(balanceAlert(rows, '2026-06-11'), null); // run length 1 < 5
});

test('lifeTrend: percent change of summed points, last 30 vs previous 30', () => {
  const mk = pts => ({ points: pts, score: dayScore(pts) });
  const rows = {};
  // previous window (2026-04-14 .. 2026-05-13): skill 20/day
  let d = '2026-05-13';
  for (let i = 0; i < 30; i++) { rows[d] = mk({ skill: 20, uni: 0, health: 0, fin: 0, eng: 0, mind: 0, refl: 0 }); d = prevDate(d); }
  // current window (2026-05-14 .. 2026-06-12): skill 30/day
  d = '2026-06-12';
  for (let i = 0; i < 30; i++) { rows[d] = mk({ skill: 30, uni: 0, health: 0, fin: 0, eng: 0, mind: 0, refl: 0 }); d = prevDate(d); }
  const t = lifeTrend(rows, '2026-06-12');
  assert.equal(t.pillars.skill, 50);   // (900-600)/600
  assert.equal(t.pillars.uni, null);   // prev sum 0 -> no fake %
  assert.equal(t.overall, 50);         // avg score 30 vs 20
});

test('lifeTrend: no data in previous window -> all null', () => {
  const rows = { '2026-06-12': { points: { skill: 40 }, score: 40 } };
  const t = lifeTrend(rows, '2026-06-12');
  assert.equal(t.pillars.skill, null);
  assert.equal(t.overall, null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: new tests FAIL, old tests PASS

- [ ] **Step 3: Append implementation to `score.js`**

```js
// ---- balance alert (spec §7): pillar earning < 50% of its max for >= 5
// consecutive days, counted back from yesterday. Missing days count as 0,
// but never look back before the earliest recorded day. Worst pillar wins. ----

export function balanceAlert(pointsByDate, yesterdayStr) {
  const dates = Object.keys(pointsByDate);
  if (dates.length === 0) return null;
  const earliest = dates.sort()[0];
  let worst = null;
  for (const k of Object.keys(WEIGHTS)) {
    let n = 0, d = yesterdayStr;
    while (d >= earliest && n < 60) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add score.js tests/score.test.js
git commit -m "feat: balance alert and life trend calculations"
```

---

### Task 5: score.js — timer helpers (TDD)

**Files:**
- Modify: `score.js` (append)
- Test: `tests/score.test.js` (append)

- [ ] **Step 1: Append failing tests to `tests/score.test.js`**

Add to the import list: `elapsedMinutes, fmtElapsed`

```js
test('elapsedMinutes floors partial minutes', () => {
  const start = '2026-06-12T10:00:00.000Z';
  const now = Date.parse('2026-06-12T10:23:41.000Z');
  assert.equal(elapsedMinutes(start, now), 23);
  assert.equal(elapsedMinutes(start, Date.parse(start)), 0);
});

test('fmtElapsed renders MM:SS under an hour, H:MM:SS above', () => {
  const start = '2026-06-12T10:00:00.000Z';
  assert.equal(fmtElapsed(start, Date.parse('2026-06-12T10:23:41Z')), '23:41');
  assert.equal(fmtElapsed(start, Date.parse('2026-06-12T11:02:09Z')), '1:02:09');
  assert.equal(fmtElapsed(start, Date.parse('2026-06-12T10:00:05Z')), '00:05');
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: new tests FAIL, old tests PASS

- [ ] **Step 3: Append implementation to `score.js`**

```js
// ---- timer helpers ----

export function elapsedMinutes(startedAtIso, nowMs) {
  return Math.floor((nowMs - Date.parse(startedAtIso)) / 60000);
}

export function fmtElapsed(startedAtIso, nowMs) {
  const sec = Math.max(0, Math.floor((nowMs - Date.parse(startedAtIso)) / 1000));
  const h = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add score.js tests/score.test.js
git commit -m "feat: timer elapsed-time helpers"
```

---

### Task 6: setup.sql + db.js

No unit tests here — `db.js` is a thin wrapper over supabase-js; it gets exercised live from Task 9 onward and in the Task 17 checklist. Rule: **every db function throws on error** (no swallowing).

**Files:**
- Create: `setup.sql`, `db.js`

- [ ] **Step 1: Create `setup.sql`**

```sql
-- Momentum schema. Paste into Supabase Dashboard > SQL Editor > Run.

create table if not exists days (
  date date primary key,
  data jsonb not null default '{}'::jsonb,
  score int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists app_state (
  key text primary key,
  value jsonb
);

alter table days enable row level security;
alter table app_state enable row level security;

-- Single-user app: any authenticated user (only Heng has an account) gets full access.
create policy "authenticated full access" on days
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on app_state
  for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Create `db.js`**

```js
// Supabase access layer. Every function throws on error — callers decide
// how to surface it (error banner). Never swallow.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function getDay(date) {
  const { data, error } = await sb.from('days').select('*').eq('date', date).maybeSingle();
  if (error) throw error;
  return data; // row or null
}

export async function getDays(from, to) {
  const { data, error } = await sb.from('days')
    .select('*').gte('date', from).lte('date', to).order('date');
  if (error) throw error;
  return data;
}

export async function saveDay(date, dayData, score) {
  const { error } = await sb.from('days')
    .upsert({ date, data: dayData, score, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function getState(key, fallback) {
  const { data, error } = await sb.from('app_state').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data && data.value !== null ? data.value : fallback;
}

export async function setState(key, value) {
  const { error } = await sb.from('app_state').upsert({ key, value });
  if (error) throw error;
}

export async function getAllForExport() {
  const days = await getDays('2000-01-01', '2999-12-31');
  const { data: app_state, error } = await sb.from('app_state').select('*');
  if (error) throw error;
  return { exported_at: new Date().toISOString(), days, app_state };
}
```

- [ ] **Step 3: Commit**

```bash
git add setup.sql db.js
git commit -m "feat: supabase schema and data access layer"
```

---

### Task 7: index.html + manifest + icon (static shell)

**Files:**
- Create: `index.html`, `manifest.json`, `icon.svg`

- [ ] **Step 1: Create `icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3DDC84"/><stop offset="1" stop-color="#34D3C3"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="120" fill="#0B0E13"/>
  <rect x="36" y="36" width="440" height="440" rx="96" fill="url(#g)"/>
  <text x="256" y="350" text-anchor="middle" font-family="Sora, Inter, sans-serif"
    font-weight="800" font-size="280" fill="#06281A">M</text>
</svg>
```

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "name": "Momentum",
  "short_name": "Momentum",
  "description": "Life dashboard — did I move my life forward today?",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#0B0E13",
  "theme_color": "#0B0E13",
  "icons": [{ "src": "icon.svg", "sizes": "any", "type": "image/svg+xml" }]
}
```

- [ ] **Step 3: Create `index.html`**

All view content is rendered by `app.js` into `<main id="view">`. The shell only holds chrome that exists on every page.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Momentum</title>
<meta name="theme-color" content="#0B0E13">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<!-- login overlay (hidden once a session exists) -->
<div id="login" class="login hidden">
  <form id="loginform" class="login-card">
    <div class="logo"><i>M</i><b>Momentum</b></div>
    <input id="email" type="email" placeholder="Email" autocomplete="username" required>
    <input id="password" type="password" placeholder="Password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
    <p id="loginerr" class="login-err"></p>
  </form>
</div>

<!-- desktop sidebar / mobile bottom tabs: same links, CSS decides layout -->
<nav id="nav">
  <div class="logo nav-logo"><i>M</i><b>Momentum</b></div>
  <a href="#today"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>Today</a>
  <a href="#week"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Week</a>
  <a href="#month"><svg viewBox="0 0 24 24"><path d="M4 19V10M10 19V5M16 19v-7M21 19H3"/></svg>Month</a>
  <a href="#settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>Settings</a>
  <div id="navtimer"></div>
</nav>

<main id="view"><p class="loading">Loading…</p></main>

<!-- save-error banner: visible failure + retry, errors are never swallowed -->
<div id="err" class="errbar hidden">
  <span>⚠️ Save failed: <b id="errmsg"></b></span>
  <button id="retry">Retry</button>
</div>

<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Verify shell renders**

Run: `open index.html`
Expected: unstyled page with nav links and "Loading…" (style.css and app.js don't exist yet — console errors are expected at this step).

- [ ] **Step 5: Commit**

```bash
git add index.html manifest.json icon.svg
git commit -m "feat: app shell, PWA manifest, icon"
```

---

### Task 8: style.css (full stylesheet)

Consolidates the approved mockups (`design/`). Mobile-first; at ≥920px the bottom tab bar becomes a left sidebar and pillar cards form a 3-column grid — matching `today-desktop.html`.

**Files:**
- Create: `style.css`

- [ ] **Step 1: Create `style.css`**

```css
/* ===== tokens (from design/foundation/design-system.html) ===== */
:root{
  --bg:#0B0E13; --surface:#141A23; --surface2:#1B2330; --line:rgba(255,255,255,.07);
  --text:#EAF0F7; --muted:#93A0B4; --faint:#5C6A7E;
  --skill:#F5B83D; --uni:#5BA8FF; --health:#3DDC84; --fin:#B98CF5;
  --eng:#FF8A8A; --mind:#8E9BFF; --refl:#34D3C3;
  --red:#F8615A; --yellow:#F2C94C; --green:#3DDC84;
}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;min-height:100dvh}
button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
input,textarea{font:inherit;color:var(--text)}
.hidden{display:none !important}
.loading{padding:40px;color:var(--faint)}

/* ===== logo ===== */
.logo{display:flex;align-items:center;gap:10px}
.logo i{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-style:normal;
  background:linear-gradient(135deg,#3DDC84,#34D3C3);color:#06281A;font-family:Sora,sans-serif;font-weight:800;font-size:15px}
.logo b{font-family:Sora,sans-serif;font-size:16px;font-weight:700}

/* ===== login ===== */
.login{position:fixed;inset:0;z-index:50;background:var(--bg);display:grid;place-items:center;padding:24px}
.login-card{width:min(360px,100%);background:var(--surface);border:1px solid var(--line);border-radius:24px;
  padding:28px;display:flex;flex-direction:column;gap:12px}
.login-card .logo{margin-bottom:8px}
.login-card input{background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.login-card button{background:linear-gradient(135deg,#3DDC84,#34D3C3);color:#06281A;font-weight:700;
  border-radius:12px;padding:12px}
.login-err{color:var(--red);font-size:13px;min-height:1em}

/* ===== nav: bottom tabs on mobile, sidebar on desktop ===== */
#nav{position:fixed;bottom:0;left:0;right:0;z-index:40;display:flex;justify-content:space-around;align-items:center;
  background:rgba(11,14,19,.85);backdrop-filter:blur(14px);border-top:1px solid var(--line);
  padding:10px 8px calc(10px + env(safe-area-inset-bottom))}
#nav a{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10.5px;font-weight:600;
  color:var(--faint);text-decoration:none;width:64px}
#nav a.on{color:var(--text)}
#nav svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
#nav a.on svg{stroke:var(--green)}
.nav-logo,#navtimer{display:none}
#view{max-width:600px;margin:0 auto;padding:22px 16px 110px}

@media (min-width:920px){
  #nav{top:0;bottom:0;left:0;right:auto;width:218px;flex-direction:column;justify-content:flex-start;
    align-items:stretch;gap:6px;border-top:none;border-right:1px solid var(--line);padding:26px 16px}
  #nav a{flex-direction:row;gap:11px;width:auto;font-size:13.5px;font-weight:500;padding:10px 12px;border-radius:12px}
  #nav a.on{background:var(--surface);border:1px solid var(--line)}
  #nav svg{width:18px;height:18px}
  .nav-logo{display:flex;padding:0 10px;margin-bottom:22px}
  #navtimer{display:block;margin-top:auto}
  #view{max-width:1080px;margin-left:218px;padding:30px 34px 60px}
}

/* ===== shared bits ===== */
.headrow{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding:0 2px}
.headrow h1{font-family:Sora,sans-serif;font-size:22px;font-weight:700}
.headrow p{font-size:12.5px;color:var(--faint);font-weight:500;margin-top:2px}
.streak{display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--line);
  border-radius:99px;padding:8px 14px;font-family:Sora,sans-serif;font-weight:700;font-size:15px}
.streak small{font-size:10px;color:var(--faint);font-weight:600;letter-spacing:.06em}
.navbtns{display:flex;gap:8px}
.navbtns button{width:32px;height:32px;display:grid;place-items:center;border-radius:10px;background:var(--surface);
  border:1px solid var(--line);color:var(--muted);font-weight:600}
.card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:17px;margin-bottom:12px}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);font-weight:600;margin-bottom:14px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:5px 12px;border-radius:99px;width:fit-content}
.pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.green{background:rgba(61,220,132,.13);color:var(--green)}
.pill.yellow{background:rgba(242,201,76,.13);color:var(--yellow)}
.pill.red{background:rgba(248,97,90,.13);color:var(--red)}

/* ===== mission ===== */
.mission{background:linear-gradient(135deg,#15231D,#141A23 60%);border:1px solid color-mix(in srgb,var(--green) 25%,transparent);
  border-radius:24px;padding:16px 17px;margin-bottom:12px}
.m-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.m-label{font-size:10.5px;font-weight:700;letter-spacing:.1em;color:var(--green)}
.m-deadline{font-size:11.5px;color:var(--muted);font-weight:500}
.mission h2{font-family:Sora,sans-serif;font-size:19px;font-weight:700;margin-bottom:12px;text-transform:none;letter-spacing:0;color:var(--text)}
.m-bar{height:7px;border-radius:99px;background:var(--surface2);overflow:hidden}
.m-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--green),var(--refl))}
.m-foot{display:flex;justify-content:space-between;margin-top:7px;font-size:11.5px;color:var(--faint);font-weight:500}
.m-foot b{color:var(--green);font-family:Sora,sans-serif}

/* ===== hero (score ring) ===== */
.hero{display:flex;align-items:center;gap:18px;background:linear-gradient(135deg,var(--surface),#10161F);
  border:1px solid var(--line);border-radius:24px;padding:18px;margin-bottom:12px}
.ringwrap{position:relative;display:grid;place-items:center;flex:none}
.ring{width:118px;aspect-ratio:1;border-radius:50%;
  background:conic-gradient(var(--rc) calc(var(--p)*1%),#222B38 0);
  -webkit-mask:radial-gradient(farthest-side,#0000 calc(100% - 11px),#000 calc(100% - 10px));
  mask:radial-gradient(farthest-side,#0000 calc(100% - 11px),#000 calc(100% - 10px));
  filter:drop-shadow(0 0 14px color-mix(in srgb,var(--rc) 25%,transparent))}
.ringwrap>div:last-child{position:absolute;text-align:center}
.rn{font-family:Sora,sans-serif;font-size:34px;font-weight:800;letter-spacing:-.02em}
.rs{font-size:10.5px;color:var(--faint);font-weight:600;margin-top:-2px}
.hero-r{display:flex;flex-direction:column;gap:9px}
.stat-line{font-size:12.5px;color:var(--muted)}
.stat-line b{color:var(--text);font-weight:600}

/* ===== win + alert ===== */
.win{display:flex;gap:11px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);
  border-radius:20px;padding:14px 15px;margin-bottom:11px;font-size:17px}
.win>div{flex:1}
.win label{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--skill);margin-bottom:5px}
.win input{width:100%;background:transparent;border:none;outline:none;font-size:13.5px}
.win input::placeholder{color:var(--faint)}
.alert{display:flex;gap:9px;align-items:center;background:rgba(242,201,76,.09);border:1px solid rgba(242,201,76,.25);
  border-radius:14px;padding:11px 14px;margin-bottom:11px;font-size:12.5px;font-weight:500;color:#E8D9A0}

/* ===== pillar cards ===== */
.pillars{display:grid;gap:11px}
.pillar{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:15px}
.pillar.done{outline:1px solid color-mix(in srgb,var(--c) 35%,transparent)}
.pillar.running{outline:1px solid color-mix(in srgb,var(--c) 45%,transparent);
  box-shadow:0 0 26px color-mix(in srgb,var(--c) 13%,transparent)}
.p-head{display:flex;align-items:center;gap:11px}
.p-ic{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:18px;flex:none;
  background:color-mix(in srgb,var(--c) 14%,transparent)}
.p-t{min-width:0}
.p-t h3{font-size:15px;font-weight:600}
.p-t span{font-size:11.5px;color:var(--faint)}
.p-pts{margin-left:auto;font-family:Sora,sans-serif;font-weight:700;font-size:16px;color:var(--c)}
.p-pts small{color:var(--faint);font-weight:600;font-size:11px}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
.chip{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:500;color:var(--muted);
  padding:9px 13px;border-radius:12px;border:1px solid var(--line);background:var(--surface2)}
.chip svg{width:12px;height:12px;stroke:var(--faint);stroke-width:2.6;fill:none;stroke-linecap:round;stroke-linejoin:round}
.chip.on{color:var(--text);border-color:transparent;background:color-mix(in srgb,var(--c) 16%,transparent)}
.chip.on svg{stroke:var(--c)}
.min{display:flex;align-items:center;gap:10px;margin-top:12px}
.tbtn{width:34px;height:34px;border-radius:50%;flex:none;display:grid;place-items:center;
  background:color-mix(in srgb,var(--c) 14%,transparent)}
.tbtn svg{width:13px;height:13px;fill:var(--c)}
.tbtn.stop{background:var(--c)}
.tbtn.stop svg{fill:#0B0E13}
.bar{height:6px;border-radius:99px;background:var(--surface2);overflow:hidden;flex:1}
.bar i{display:block;height:100%;border-radius:99px;background:var(--c)}
.mlabel{font-size:11.5px;color:var(--muted);font-weight:500;white-space:nowrap}
button.mlabel{text-decoration:underline dotted var(--faint);text-underline-offset:3px}
.live{display:inline-flex;align-items:center;gap:6px;font-family:Sora,sans-serif;font-weight:700;color:var(--c);
  font-size:13px;font-variant-numeric:tabular-nums}
.live i{width:7px;height:7px;border-radius:50%;background:var(--c);animation:pulse 1.2s infinite}
@keyframes pulse{50%{opacity:.35}}
.note{display:block;width:100%;margin-top:10px;background:var(--surface2);border:1px solid var(--line);
  border-radius:11px;padding:9px 12px;font-size:12.5px;line-height:1.4;outline:none}
.note::placeholder{color:var(--faint)}
.refl label{display:block;font-size:12px;color:var(--muted);font-weight:500;margin:12px 0 6px}
.refl textarea{display:block;width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:12px;
  padding:11px 13px;font-size:13.5px;line-height:1.45;resize:vertical;min-height:44px;outline:none}
.refl textarea::placeholder{color:var(--faint)}
.tracknow{position:fixed;bottom:calc(78px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);
  z-index:30;display:flex;align-items:center;gap:10px;background:#0F1722;
  border:1px solid color-mix(in srgb,var(--c) 40%,transparent);border-radius:99px;
  padding:10px 16px;font-size:12.5px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.5);white-space:nowrap}
.tracknow em{font-style:normal;color:var(--faint);font-weight:500}
.navtimer-card{background:var(--surface);border:1px solid color-mix(in srgb,var(--c) 40%,transparent);
  border-radius:16px;padding:14px;text-align:center;display:flex;flex-direction:column;gap:4px;align-items:center}
.navtimer-card b{font-size:14px}
.navtimer-card span{font-size:10.5px;color:var(--faint);font-weight:600;letter-spacing:.06em}

@media (min-width:920px){
  .pillars{grid-template-columns:repeat(3,1fr)}
  .pillar.refl{grid-column:span 3}
  .refl-qs{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
  .tracknow{display:none}
  .topgrid{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:14px}
}

/* ===== week / month ===== */
.days7{display:flex;justify-content:space-between}
.day7{display:flex;flex-direction:column;align-items:center;gap:8px}
.day7 em{font-style:normal;font-size:10.5px;font-weight:600;color:var(--faint);letter-spacing:.04em}
.dot{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;
  font-family:Sora,sans-serif;font-size:12px;font-weight:700}
.dot.green{background:rgba(61,220,132,.16);color:var(--green)}
.dot.yellow{background:rgba(242,201,76,.14);color:var(--yellow)}
.dot.red{background:rgba(248,97,90,.14);color:var(--red)}
.dot.off{background:var(--surface2);color:var(--faint);font-size:14px}
.dot.today{outline:2px solid var(--green)}
.stats3{display:flex;gap:12px;margin-bottom:12px}
.stat3{flex:1;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:15px}
.stat3 b{display:block;font-family:Sora,sans-serif;font-size:26px;font-weight:800;letter-spacing:-.02em}
.stat3 b small{font-size:13px;color:var(--faint);font-weight:600}
.stat3 span{font-size:10.5px;color:var(--faint);font-weight:600;letter-spacing:.04em}
.hb{display:grid;grid-template-columns:30px 1fr 56px;align-items:center;gap:11px;margin-bottom:12px}
.hb:last-child{margin-bottom:2px}
.hb i{font-style:normal;font-size:16px}
.hb .track{height:9px;border-radius:99px;background:var(--surface2);overflow:hidden}
.hb .track b{display:block;height:100%;border-radius:99px;background:var(--c)}
.hb span{font-size:12px;color:var(--muted);font-weight:600;text-align:right;font-variant-numeric:tabular-nums}
.insight{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5;color:var(--muted)}
.insight b{color:var(--text)}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:7px}
.cal em{font-style:normal;font-size:10px;font-weight:600;color:var(--faint);text-align:center;letter-spacing:.04em}
.c{aspect-ratio:1;border-radius:9px;background:var(--surface2);display:grid;place-items:center;
  font-size:10.5px;font-weight:600;color:var(--faint)}
.c.green{background:rgba(61,220,132,.2);color:var(--green)}
.c.green2{background:rgba(61,220,132,.42);color:#CFF8E2}
.c.yellow{background:rgba(242,201,76,.2);color:var(--yellow)}
.c.red{background:rgba(248,97,90,.2);color:var(--red)}
.c.today{outline:2px solid var(--green)}
.c.future{background:transparent;border:1px dashed var(--line)}
.c.blank{background:transparent}
.legend{display:flex;gap:14px;margin-top:13px;font-size:11px;color:var(--faint);font-weight:500}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.chart svg{width:100%;height:110px;display:block}
.gl{stroke:var(--line);stroke-width:1}
.glt{font-size:9px;fill:var(--faint);font-family:Inter}
.t-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;
  border-bottom:1px dashed var(--line);font-size:13.5px;font-weight:500}
.t-row:last-child{border-bottom:0}
.t-row.big{font-weight:700;font-size:15px;font-family:Sora,sans-serif}
.t-row b{font-family:Sora,sans-serif;font-weight:700;font-variant-numeric:tabular-nums}
.up{color:var(--green)} .down{color:var(--red)} .flat{color:var(--faint)}
.winlist{font-size:13px;line-height:1.6;color:var(--muted)}
.winlist b{color:var(--text);font-weight:600}
.winlist em{font-style:normal;color:var(--faint);font-size:11.5px;margin-right:8px;font-variant-numeric:tabular-nums}

/* ===== settings ===== */
.set-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px dashed var(--line)}
.set-row:last-child{border-bottom:0}
.set-row label{font-size:13.5px;font-weight:500}
.set-row input[type=number],.set-row input[type=text],.set-row input[type=date]{width:110px;background:var(--surface2);
  border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:13px;text-align:right;outline:none}
.set-row input[type=text]{width:200px;text-align:left}
.set-row input[type=range]{width:150px;accent-color:var(--green)}
.btnrow{display:flex;gap:10px;margin-top:6px}
.btn{flex:1;background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:12px;font-weight:600;font-size:13.5px;text-align:center}
.btn.danger{color:var(--red)}

/* ===== error banner ===== */
.errbar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:60;display:flex;gap:14px;align-items:center;
  background:#2A1416;border:1px solid rgba(248,97,90,.4);border-radius:14px;padding:11px 16px;font-size:13px;max-width:90vw}
.errbar b{font-weight:600;word-break:break-word}
.errbar button{background:var(--red);color:#fff;border-radius:9px;padding:6px 14px;font-weight:700;font-size:12.5px}
```

- [ ] **Step 2: Verify against mockup**

Run: `open index.html` — shell now styled (dark bg, bottom tabs on narrow window, sidebar when window ≥920px wide). Compare colors/spacing with `design/screens/today-mobile.html` side by side.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: full stylesheet consolidated from approved mockups"
```

---

### Task 9: Supabase project setup (USER STEP — pause and walk Heng through it)

ES modules don't load over `file://` — from here on run a local server:
`python3 -m http.server 8000` then open `http://localhost:8000`.

- [ ] **Step 1: Create the Supabase project** (user does this; agent provides these instructions)

1. Sign up at https://supabase.com (free) → "New project" → name `momentum`, region Southeast Asia (Singapore), generate a strong DB password (Supabase stores it; not needed daily).
2. Wait for the project to provision.

- [ ] **Step 2: Create tables** — Dashboard → SQL Editor → paste the entire contents of `setup.sql` → Run. Expected: "Success. No rows returned".

- [ ] **Step 3: Create the single user account** — Dashboard → Authentication → Users → "Add user" → email + password (Heng's choice). Then Authentication → Sign In / Up → turn **off** "Allow new users to sign up".

- [ ] **Step 4: Fill `config.js`** — Dashboard → Project Settings → API: copy "Project URL" and "anon public" key into `config.js`, replacing the placeholders.

- [ ] **Step 5: Smoke-test the connection**

Run: `python3 -m http.server 8000` and open `http://localhost:8000` — in the browser console run:

```js
const { sb } = await import('./db.js');
(await sb.auth.signInWithPassword({ email: '<email>', password: '<password>' })).error // → null
(await sb.from('days').select('*')).error                                              // → null
```

Expected: both `null`.

- [ ] **Step 6: Commit**

```bash
git add config.js
git commit -m "chore: point config at the live Supabase project"
```

---

### Task 10: app.js — boot, auth, routing, save pipeline

**Files:**
- Create: `app.js`

- [ ] **Step 1: Create `app.js`**

```js
// App bootstrap, routing, rendering. Views are template strings rendered into
// #view; interactions use event delegation via data-action attributes.

import * as S from './score.js';
import * as db from './db.js';

const PILLARS = [
  { key: 'skill', name: 'Skill & Income', icon: '💰',
    tags: [['learn', 'Learn'], ['code', 'Code'], ['project', 'Project'], ['research', 'Research'], ['freelance', 'Freelance']] },
  { key: 'uni', name: 'University', icon: '🎓',
    tags: [['class', 'Attend class'], ['review', 'Review'], ['homework', 'Homework'], ['readahead', 'Read ahead']] },
  { key: 'health', name: 'Health', icon: '💪', tags: [] },
  { key: 'fin', name: 'Financial Education', icon: '📚', tags: [] },
  { key: 'eng', name: 'English', icon: '🇬🇧', tags: [] },
  { key: 'mind', name: 'Mindfulness', icon: '🧘',
    tags: [['meditate', 'Meditate'], ['selfreview', 'Self-review'], ['gratitude', 'Gratitude']] },
];

// ---- state ----
let targets = { ...S.DEFAULT_TARGETS };
let mission = null;             // {title, deadline, progress} | null
let timer = null;               // {pillar, started_at} | null
let today = S.toDateStr(new Date());
let day = emptyDay();           // today's data (spec §5 shape)
let weekOffset = 0;
let monthOffset = 0;

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function emptyDay() {
  return { minutes: {}, tags: {}, sleep_ok: false, notes: {}, win: '', reflect: { wrong: '', tomorrow: '' }, points: {} };
}

function pillarName(key) {
  return key === 'refl' ? 'Reflection' : PILLARS.find(p => p.key === key).name;
}

function fmtLongDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ---- error banner: failures are shown, retriable, and rethrown — never swallowed ----
let lastFailed = null;
function showError(e) { $('#errmsg').textContent = e.message || String(e); $('#err').classList.remove('hidden'); console.error(e); }
function hideError() { $('#err').classList.add('hidden'); }
$('#retry').addEventListener('click', () => { if (lastFailed) lastFailed(); });

// ---- saving today's row ----
let saveDebounce = null;
function queueSave() { clearTimeout(saveDebounce); saveDebounce = setTimeout(saveToday, 800); }
async function saveToday() {
  day.points = S.dayPoints(day, targets);
  try { await db.saveDay(today, day, S.dayScore(day.points)); hideError(); }
  catch (e) { lastFailed = saveToday; showError(e); throw e; }
}

// ---- boot ----
async function boot() {
  const session = await db.getSession();
  if (!session) { $('#login').classList.remove('hidden'); $('#view').innerHTML = ''; return; }
  targets = await db.getState('targets', { ...S.DEFAULT_TARGETS });
  mission = await db.getState('mission', null);
  timer = await db.getState('timer', null);
  await loadToday();
  window.addEventListener('hashchange', render);
  setInterval(tick, 1000);
  await render();
}

async function loadToday() {
  const row = await db.getDay(today);
  day = row ? { ...emptyDay(), ...row.data } : emptyDay();
}

$('#loginform').addEventListener('submit', async ev => {
  ev.preventDefault();
  try { await db.signIn($('#email').value, $('#password').value); location.reload(); }
  catch (e) { $('#loginerr').textContent = e.message; throw e; }
});

// ---- routing ----
function route() { return location.hash.replace('#', '') || 'today'; }
async function render() {
  const r = route();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + r));
  try {
    if (r === 'week') await renderWeek();
    else if (r === 'month') await renderMonth();
    else if (r === 'settings') await renderSettings();
    else await renderToday();
  } catch (e) { showError(e); throw e; }
}

// view stubs — replaced one by one in Tasks 11, 13, 14, 15
async function renderToday() { $('#view').innerHTML = '<p class="loading">Today</p>'; }
async function renderWeek() { $('#view').innerHTML = '<p class="loading">Week</p>'; }
async function renderMonth() { $('#view').innerHTML = '<p class="loading">Month</p>'; }
async function renderSettings() { $('#view').innerHTML = '<p class="loading">Settings</p>'; }
async function toggleTimer() {} // implemented in Task 12

// ---- per-second tick: live clocks + midnight rollover ----
function tick() {
  const now = S.toDateStr(new Date());
  if (now !== today) { today = now; loadToday().then(render); return; }
  if (timer) {
    const txt = S.fmtElapsed(timer.started_at, Date.now());
    document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = txt; });
  }
}

boot();
```

- [ ] **Step 2: Verify login flow**

With the dev server running, open `http://localhost:8000`:
- Login overlay appears → wrong password shows the Supabase error text under the form.
- Correct credentials → page reloads, overlay gone, nav highlights "Today", view shows the stub text.
- Reload again → still signed in (session persisted).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: app boot, auth flow, routing, save pipeline"
```

---

### Task 11: Today view

**Files:**
- Modify: `score.js` (append `bestStreak`), `tests/score.test.js` (append), `app.js` (replace `renderToday` stub, add helpers + event delegation)

- [ ] **Step 1: TDD `bestStreak` — append failing test to `tests/score.test.js`**

Add `bestStreak` to the import list.

```js
test('bestStreak finds the longest >=40 run anywhere in history', () => {
  assert.equal(bestStreak({}), 0);
  assert.equal(bestStreak({
    '2026-06-01': 80, '2026-06-02': 45, '2026-06-03': 20, // run of 2
    '2026-06-05': 80, '2026-06-06': 80, '2026-06-07': 80, // gap on 04, run of 3
  }), 3);
});
```

Run: `npm test` — expected: new test FAILS.

- [ ] **Step 2: Append implementation to `score.js`**

```js
export function bestStreak(scoreByDate) {
  const dates = Object.keys(scoreByDate).sort();
  let best = 0, run = 0, prev = null;
  for (const d of dates) {
    if (scoreByDate[d] >= 40) {
      run = (prev !== null && prevDate(d) === prev) ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    } else { run = 0; prev = null; }
  }
  return best;
}
```

Run: `npm test` — expected: all PASS.

- [ ] **Step 3: Replace the `renderToday` stub in `app.js`** with the real view + card builders:

```js
function chipBtn(pillarKey, id, label, on) {
  return `<button class="chip ${on ? 'on' : ''}" data-action="tag" data-pillar="${pillarKey}" data-id="${id}">
    <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>${label}</button>`;
}

function pillarCard(p, points) {
  const max = S.WEIGHTS[p.key];
  const t = targets[p.key];
  const mins = day.minutes[p.key] || 0;
  const running = !!(timer && timer.pillar === p.key);
  const done = mins >= t;
  const pct = Math.min(100, Math.round(mins / t * 100));
  const chips = p.tags.map(([id, label]) => chipBtn(p.key, id, label, (day.tags[p.key] || []).includes(id))).join('')
    + (p.key === 'health' ? `<button class="chip ${day.sleep_ok ? 'on' : ''}" data-action="sleep">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>Slept 7h+</button>` : '');
  const sub = `${mins} / ${t} min${running ? ' · tracking…' : done ? ' · done ✦' : ''}`;
  return `
  <article class="pillar ${running ? 'running' : done ? 'done' : ''}" style="--c:var(--${p.key})">
    <div class="p-head">
      <div class="p-ic">${p.icon}</div>
      <div class="p-t"><h3>${p.name}</h3><span>${sub}</span></div>
      <div class="p-pts">${points[p.key]}<small> /${max}</small></div>
    </div>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    <div class="min">
      <button class="tbtn ${running ? 'stop' : ''}" data-action="timer" data-pillar="${p.key}">
        ${running ? '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
                  : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'}
      </button>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${running
        ? `<span class="mlabel"><span class="live"><i></i><span data-elapsed>00:00</span></span> · ${mins}/${t}</span>`
        : `<button class="mlabel" data-action="editmin" data-pillar="${p.key}" title="Tap to edit minutes">${mins}/${t}</button>`}
    </div>
    <input class="note" data-note="${p.key}" placeholder="What did you do? (optional)" value="${esc(day.notes[p.key])}">
  </article>`;
}

function daysLeftText(deadline) {
  if (!deadline) return '';
  const diff = Math.ceil((new Date(deadline + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  return diff >= 0 ? ` · ${diff} days left` : ' · overdue';
}

function trackNowHtml() {
  const p = PILLARS.find(x => x.key === timer.pillar);
  return `<button class="tracknow" style="--c:var(--${p.key})" data-action="timer" data-pillar="${p.key}">
    <span class="live"><i></i><span data-elapsed>00:00</span></span> ${p.icon} ${p.name} <em>· tap to stop</em>
  </button>`;
}

function renderNavTimer() {
  const el = $('#navtimer');
  if (!timer) { el.innerHTML = ''; return; }
  const p = PILLARS.find(x => x.key === timer.pillar);
  el.innerHTML = `<button class="navtimer-card" style="--c:var(--${p.key})" data-action="timer" data-pillar="${p.key}">
    <span class="live"><i></i><span data-elapsed>00:00</span></span>
    <b>${p.icon} ${p.name}</b><span>TRACKING · CLICK TO STOP</span></button>`;
}

async function renderToday() {
  const rows = await db.getDays(S.addDays(today, -60), S.prevDate(today));
  const scoreByDate = {}, pointsByDate = {};
  for (const r of rows) { scoreByDate[r.date] = r.score; pointsByDate[r.date] = r.data.points || {}; }

  const points = S.dayPoints(day, targets);
  const score = S.dayScore(points);
  const status = S.dayStatus(score);
  scoreByDate[today] = score;
  const stk = S.streak(scoreByDate, today);
  const best = S.bestStreak(scoreByDate);
  const alert = S.balanceAlert(pointsByDate, S.prevDate(today));
  const monthScores = rows.filter(r => r.date.slice(0, 7) === today.slice(0, 7)).map(r => r.score).concat(score);
  const monthAvg = Math.round(monthScores.reduce((a, b) => a + b, 0) / monthScores.length);
  const statusLabel = { green: 'Green Day', yellow: 'Yellow Day', red: 'Red Day' }[status];

  const missionHtml = mission && mission.title ? `
    <section class="mission">
      <div class="m-top"><span class="m-label">🎯 CURRENT MISSION</span>
        <span class="m-deadline">${esc(mission.deadline)}${daysLeftText(mission.deadline)}</span></div>
      <h2>${esc(mission.title)}</h2>
      <div class="m-bar"><i style="width:${mission.progress || 0}%"></i></div>
      <div class="m-foot"><span>Progress</span><b>${mission.progress || 0}%</b></div>
    </section>` : '';

  $('#view').innerHTML = `
    <div class="headrow">
      <div><h1>Today</h1><p>${fmtLongDate(today)}</p></div>
      <div class="streak">🔥 ${stk} <small>DAYS</small></div>
    </div>
    ${missionHtml}
    <section class="hero">
      <div class="ringwrap">
        <div class="ring" style="--p:${score};--rc:var(--${status})"></div>
        <div><div class="rn">${score}</div><div class="rs">/ 100</div></div>
      </div>
      <div class="hero-r">
        <span class="pill ${status}"><i></i>${statusLabel}</span>
        <span class="stat-line">Month average <b>${monthAvg}</b></span>
        <span class="stat-line">Best streak <b>${best} days</b></span>
      </div>
    </section>
    <section class="win">🏆
      <div><label>BIGGEST WIN TODAY</label>
        <input id="winput" placeholder="What are you most proud of today?" value="${esc(day.win)}"></div>
    </section>
    ${alert ? `<div class="alert">⚠️ ${pillarName(alert.pillar)} below target — ${alert.days} days in a row</div>` : ''}
    <div class="pillars">
      ${PILLARS.map(p => pillarCard(p, points)).join('')}
      <article class="pillar refl" style="--c:var(--refl)">
        <div class="p-head">
          <div class="p-ic">🌱</div>
          <div class="p-t"><h3>Reflection</h3><span>2 questions before bed</span></div>
          <div class="p-pts">${points.refl}<small> /5</small></div>
        </div>
        <div class="refl-qs">
          <div><label>What went wrong?</label>
            <textarea data-reflect="wrong" rows="2">${esc(day.reflect.wrong)}</textarea></div>
          <div><label>One thing for tomorrow?</label>
            <textarea data-reflect="tomorrow" rows="2">${esc(day.reflect.tomorrow)}</textarea></div>
        </div>
      </article>
    </div>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}
```

- [ ] **Step 4: Add event delegation at the bottom of `app.js`, just above `boot();`**

```js
// ---- events (delegated on body: views are re-rendered, listeners are not) ----

document.body.addEventListener('click', async ev => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  try {
    if (a === 'tag') {
      const { pillar, id } = btn.dataset;
      const arr = day.tags[pillar] || (day.tags[pillar] = []);
      const i = arr.indexOf(id);
      i >= 0 ? arr.splice(i, 1) : arr.push(id);
      await saveToday(); await render();
    } else if (a === 'sleep') {
      day.sleep_ok = !day.sleep_ok;
      await saveToday(); await render();
    } else if (a === 'editmin') {
      const p = btn.dataset.pillar;
      const v = prompt(`Minutes for ${pillarName(p)} today:`, day.minutes[p] || 0);
      if (v === null) return;
      const n = parseInt(v, 10);
      if (Number.isNaN(n) || n < 0) return;
      day.minutes[p] = n;
      await saveToday(); await render();
    } else if (a === 'timer') {
      await toggleTimer(btn.dataset.pillar);
    } else if (a === 'weeknav') {
      weekOffset += Number(btn.dataset.dir); await render();
    } else if (a === 'monthnav') {
      monthOffset += Number(btn.dataset.dir); await render();
    } else if (a === 'export') {
      const dump = await db.getAllForExport();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `momentum-backup-${today}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } else if (a === 'logout') {
      await db.signOut(); location.reload();
    }
  } catch (e) { showError(e); throw e; }
});

document.body.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'winput') { day.win = t.value; queueSave(); }
  else if (t.dataset.note !== undefined) { day.notes[t.dataset.note] = t.value; queueSave(); }
  else if (t.dataset.reflect !== undefined) { day.reflect[t.dataset.reflect] = t.value; queueSave(); }
  else if (t.id === 'm-progress') { $('#m-pct').textContent = t.value + '%'; }
});

// after a text field loses focus, re-render so points/score refresh (not while typing)
document.body.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'winput' || t.dataset.note !== undefined || t.dataset.reflect !== undefined) render();
});
```

- [ ] **Step 5: Verify in browser** (`http://localhost:8000`)

- Today view matches `design/screens/today-mobile.html` (no mission card yet — none saved).
- Tap chips → they fill with pillar color, points number updates after re-render.
- Tap "Slept 7h+" → Health points +5.
- Tap the `0/240` minutes label → prompt → enter `210` → Skill shows 35/40, ring updates.
- Type a win + both reflection answers → blur → Reflection 5/5.
- Refresh page → everything persisted (check Supabase Table Editor: `days` has today's row with `data.points` and `score`).
- Narrow window = bottom tabs; wide window ≥920px = sidebar + 3-column cards.

- [ ] **Step 6: Commit**

```bash
git add app.js score.js tests/score.test.js
git commit -m "feat: Today view with live scoring, chips, notes, reflection"
```

---

### Task 12: Timer integration

**Files:**
- Modify: `app.js` (replace the `toggleTimer` stub)

- [ ] **Step 1: Replace `async function toggleTimer() {}` with:**

```js
async function toggleTimer(pillar) {
  if (timer && timer.pillar === pillar) { await stopTimer(); await render(); return; }
  if (timer) await stopTimer(); // switching pillars: bank the old one first
  timer = { pillar, started_at: new Date().toISOString() };
  await db.setState('timer', timer);
  await render();
}

async function stopTimer() {
  if (!timer) return;
  const t = timer; timer = null;
  await db.setState('timer', null);
  const mins = S.elapsedMinutes(t.started_at, Date.now());
  if (mins <= 0) return; // under a minute: nothing to bank
  const startDate = S.toDateStr(new Date(Date.parse(t.started_at)));
  if (startDate === today) {
    day.minutes[t.pillar] = (day.minutes[t.pillar] || 0) + mins;
    await saveToday();
  } else {
    // timer crossed midnight: credit the day it was started (spec §4)
    try {
      const row = await db.getDay(startDate);
      const d = row ? { ...emptyDay(), ...row.data } : emptyDay();
      d.minutes[t.pillar] = (d.minutes[t.pillar] || 0) + mins;
      d.points = S.dayPoints(d, targets);
      await db.saveDay(startDate, d, S.dayScore(d.points));
    } catch (e) { showError(e); throw e; }
  }
}
```

- [ ] **Step 2: Verify in browser**

- Press ▶ on University → button becomes ■, card glows, clock ticks every second, floating pill appears at the bottom (mobile width) / sidebar card (desktop width).
- Press ▶ on Skill while University runs → University stops (elapsed minutes banked into its bar after ≥1 min), Skill starts.
- Refresh the page mid-run → timer still running with correct elapsed time (state lives in `app_state`).
- Stop after ≥1 minute → minutes added, points update, row visible in Supabase.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: one-at-a-time real timer backed by app_state timestamps"
```

---

### Task 13: Week view

**Files:**
- Modify: `app.js` (replace `renderWeek` stub, add `rangeLabel` helper)

- [ ] **Step 1: Replace the `renderWeek` stub with:**

```js
function rangeLabel(from, to) {
  const opt = { month: 'short', day: 'numeric' };
  const f = new Date(from + 'T00:00:00'), t = new Date(to + 'T00:00:00');
  return `${f.toLocaleDateString('en-US', opt)} – ${t.toLocaleDateString('en-US', opt)}`;
}

async function renderWeek() {
  const monday = S.startOfWeek(S.addDays(today, weekOffset * 7));
  const dates = Array.from({ length: 7 }, (_, i) => S.addDays(monday, i));
  const rows = await db.getDays(S.addDays(monday, -60), dates[6]);
  const byDate = {}; for (const r of rows) byDate[r.date] = r;
  const names = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  const dots = dates.map((d, i) => {
    const r = byDate[d];
    const cls = r ? S.dayStatus(r.score) : 'off';
    return `<div class="day7"><em>${names[i]}</em>
      <div class="dot ${cls} ${d === today ? 'today' : ''}">${r ? r.score : '·'}</div></div>`;
  }).join('');

  const weekRows = dates.filter(d => byDate[d]).map(d => byDate[d]);
  const avg = weekRows.length ? Math.round(weekRows.reduce((a, r) => a + r.score, 0) / weekRows.length) : 0;
  const greens = weekRows.filter(r => r.score >= 80).length;
  const scoreByDate = {}; for (const r of rows) scoreByDate[r.date] = r.score;
  const stk = S.streak(scoreByDate, today);

  const hours = PILLARS.map(p => ({
    p, mins: weekRows.reduce((a, r) => a + (r.data.minutes?.[p.key] ?? 0), 0),
  }));
  const maxMins = Math.max(60, ...hours.map(h => h.mins));
  const bars = hours.map(({ p, mins }) => `
    <div class="hb" style="--c:var(--${p.key})"><i>${p.icon}</i>
      <div class="track"><b style="width:${Math.round(mins / maxMins * 100)}%"></b></div>
      <span>${(mins / 60).toFixed(1)} h</span></div>`).join('');

  let insight = 'No data yet this week — press play on a pillar to start.';
  if (weekRows.length) {
    const bestRow = weekRows.reduce((a, r) => (r.score > a.score ? r : a));
    const weakest = hours.reduce((a, h) =>
      (h.mins / (targets[h.p.key] * 7) < a.mins / (targets[a.p.key] * 7) ? h : a));
    insight = `<b>Best day: ${fmtLongDate(bestRow.date).split(',')[0]} (${bestRow.score}).</b>
      ${weakest.p.name} is furthest behind this week — one focused session catches you up.`;
  }

  $('#view').innerHTML = `
    <div class="headrow">
      <div><h1>Weekly Review</h1><p>${rangeLabel(monday, dates[6])}</p></div>
      <div class="navbtns">
        <button data-action="weeknav" data-dir="-1">‹</button>
        <button data-action="weeknav" data-dir="1">›</button>
      </div>
    </div>
    <section class="card"><h2>This week</h2><div class="days7">${dots}</div></section>
    <div class="stats3">
      <div class="stat3"><b>${avg}<small> avg</small></b><span>WEEK SCORE</span></div>
      <div class="stat3"><b>${greens}<small> /${weekRows.length}</small></b><span>GREEN DAYS</span></div>
      <div class="stat3"><b>🔥 ${stk}</b><span>STREAK</span></div>
    </div>
    <section class="card"><h2>Hours by pillar</h2>${bars}</section>
    <section class="card"><h2>Insight</h2><div class="insight">✨<p>${insight}</p></div></section>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}
```

- [ ] **Step 2: Verify in browser** — Week tab shows today's dot colored by status, stats and hour bars match what was entered; ‹ › navigates weeks. Compare layout with `design/screens/week-mobile.html`.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: weekly review view"
```

---

### Task 14: Month view

**Files:**
- Modify: `app.js` (replace `renderMonth` stub, add `monthName` helper)

- [ ] **Step 1: Replace the `renderMonth` stub with:**

```js
function monthName(m) {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][m];
}

async function renderMonth() {
  const base = new Date(today + 'T00:00:00');
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const y = base.getFullYear(), m = base.getMonth();
  const first = S.toDateStr(new Date(y, m, 1));
  const last = S.toDateStr(new Date(y, m + 1, 0));
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const trendFrom = S.addDays(today, -60);
  const rows = await db.getDays(first < trendFrom ? first : trendFrom, last > today ? last : today);
  const byDate = {}; for (const r of rows) byDate[r.date] = r;
  const monthRows = rows.filter(r => r.date >= first && r.date <= last);

  const avg = monthRows.length ? Math.round(monthRows.reduce((a, r) => a + r.score, 0) / monthRows.length) : 0;
  const greens = monthRows.filter(r => r.score >= 80).length;
  const scoreByDate = {}; for (const r of monthRows) scoreByDate[r.date] = r.score;
  const best = S.bestStreak(scoreByDate);

  // life trend — always anchored to today (spec §7)
  const trendRows = {};
  for (const r of rows) trendRows[r.date] = { points: r.data.points || {}, score: r.score };
  const trend = S.lifeTrend(trendRows, today);
  const tRow = (label, v, big = false) => {
    const cls = v === null ? 'flat' : v >= 0 ? 'up' : 'down';
    const txt = v === null ? '—' : `${v >= 0 ? '▲ +' : '▼ −'}${Math.abs(v)}%`;
    return `<div class="t-row ${big ? 'big' : ''}"><span>${label}</span><b class="${cls}">${txt}</b></div>`;
  };
  const trendHtml = tRow('Overall', trend.overall, true)
    + PILLARS.map(p => tRow(`${p.icon} ${p.name}`, trend.pillars[p.key])).join('')
    + tRow('🌱 Reflection', trend.pillars.refl);

  // calendar, Monday-first
  const firstWd = (new Date(y, m, 1).getDay() + 6) % 7;
  let cells = '<em>M</em><em>T</em><em>W</em><em>T</em><em>F</em><em>S</em><em>S</em>'
    + '<div class="c blank"></div>'.repeat(firstWd);
  for (let n = 1; n <= daysInMonth; n++) {
    const d = S.toDateStr(new Date(y, m, n));
    const r = byDate[d];
    let cls = 'c';
    if (d > today) cls += ' future';
    else if (r) {
      const st = S.dayStatus(r.score);
      cls += ' ' + (st === 'green' && r.score >= 90 ? 'green2' : st);
    }
    if (d === today) cls += ' today';
    cells += `<div class="${cls}">${n}</div>`;
  }

  // score line chart
  const pts = monthRows.map(r => {
    const n = Number(r.date.slice(8));
    const x = Math.round(14 + (n - 1) / Math.max(1, daysInMonth - 1) * 312);
    const yy = Math.round(102 - r.score / 100 * 88);
    return `${x},${yy}`;
  });
  const lastPt = pts.length ? pts[pts.length - 1].split(',') : null;
  const chart = `
    <svg viewBox="0 0 340 110" preserveAspectRatio="none">
      <line class="gl" x1="0" y1="14" x2="340" y2="14"/><text class="glt" x="2" y="11">100</text>
      <line class="gl" x1="0" y1="58" x2="340" y2="58"/><text class="glt" x="2" y="55">50</text>
      <line class="gl" x1="0" y1="102" x2="340" y2="102"/><text class="glt" x="2" y="99">0</text>
      ${pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#3DDC84"
        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      ${lastPt ? `<circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="4" fill="#3DDC84"/>` : ''}
    </svg>`;

  const totals = PILLARS.map(p => ({
    p, mins: monthRows.reduce((a, r) => a + (r.data.minutes?.[p.key] ?? 0), 0),
  }));
  const maxT = Math.max(60, ...totals.map(t => t.mins));
  const totalsHtml = totals.map(({ p, mins }) => `
    <div class="hb" style="--c:var(--${p.key})"><i>${p.icon}</i>
      <div class="track"><b style="width:${Math.round(mins / maxT * 100)}%"></b></div>
      <span>${(mins / 60).toFixed(1)} h</span></div>`).join('');

  const wins = monthRows.filter(r => r.data.win && r.data.win.trim())
    .map(r => `<div><em>${monthName(m).slice(0, 3)} ${Number(r.date.slice(8))}</em><b>${esc(r.data.win)}</b></div>`)
    .join('') || '<span>No wins recorded yet.</span>';

  $('#view').innerHTML = `
    <div class="headrow">
      <div><h1>${monthName(m)} ${y}</h1><p>Monthly review</p></div>
      <div class="navbtns">
        <button data-action="monthnav" data-dir="-1">‹</button>
        <button data-action="monthnav" data-dir="1">›</button>
      </div>
    </div>
    <div class="stats3">
      <div class="stat3"><b>${avg}</b><span>AVG SCORE</span></div>
      <div class="stat3"><b>${greens}</b><span>GREEN DAYS</span></div>
      <div class="stat3"><b>🔥 ${best}</b><span>BEST STREAK</span></div>
    </div>
    <section class="card"><h2>Life trend — last 30 days vs previous</h2>${trendHtml}</section>
    <section class="card"><h2>Calendar</h2><div class="cal">${cells}</div>
      <div class="legend">
        <span><i style="background:rgba(61,220,132,.35)"></i>Green 80+</span>
        <span><i style="background:rgba(242,201,76,.35)"></i>Yellow 40–79</span>
        <span><i style="background:rgba(248,97,90,.35)"></i>Red &lt;40</span>
      </div></section>
    <section class="card"><h2>Score trend</h2><div class="chart">${chart}</div></section>
    <section class="card"><h2>Totals this month</h2>${totalsHtml}</section>
    <section class="card"><h2>Wins this month</h2><div class="winlist">${wins}</div></section>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}
```

- [ ] **Step 2: Verify in browser** — Month tab: today's cell colored and outlined, trend rows show "—" (not enough history yet — correct per spec), wins list shows today's win. ‹ › navigates months. Compare with `design/screens/month-mobile.html`.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: monthly review with life trend, heat calendar, wins"
```

---

### Task 15: Settings view

**Files:**
- Modify: `app.js` (replace `renderSettings` stub, extend the `change` listener)

- [ ] **Step 1: Replace the `renderSettings` stub with:**

```js
async function renderSettings() {
  const tRows = PILLARS.map(p => `
    <div class="set-row"><label>${p.icon} ${p.name} target (min/day)</label>
      <input type="number" min="1" data-target="${p.key}" value="${targets[p.key]}"></div>`).join('');
  const m = mission || { title: '', deadline: '', progress: 0 };
  $('#view').innerHTML = `
    <div class="headrow"><div><h1>Settings</h1><p>Targets, mission, account</p></div></div>
    <section class="card"><h2>Daily targets</h2>${tRows}</section>
    <section class="card"><h2>Current mission</h2>
      <div class="set-row"><label>Title</label>
        <input type="text" id="m-title" value="${esc(m.title)}" placeholder="e.g. Launch TrueVibe MVP"></div>
      <div class="set-row"><label>Deadline</label>
        <input type="date" id="m-deadline" value="${esc(m.deadline)}"></div>
      <div class="set-row"><label>Progress <b id="m-pct">${m.progress || 0}%</b></label>
        <input type="range" id="m-progress" min="0" max="100" value="${m.progress || 0}"></div>
    </section>
    <section class="card"><h2>Data & account</h2>
      <div class="btnrow">
        <button class="btn" data-action="export">⬇ Export JSON backup</button>
        <button class="btn danger" data-action="logout">Log out</button>
      </div>
    </section>
    ${timer ? trackNowHtml() : ''}`;
  renderNavTimer();
}
```

- [ ] **Step 2: Extend the existing `change` listener** — replace it with:

```js
document.body.addEventListener('change', async ev => {
  const t = ev.target;
  try {
    if (t.id === 'winput' || t.dataset.note !== undefined || t.dataset.reflect !== undefined) {
      await render();
    } else if (t.dataset.target !== undefined) {
      const n = parseInt(t.value, 10);
      if (Number.isNaN(n) || n < 1) { t.value = targets[t.dataset.target]; return; }
      targets[t.dataset.target] = n;
      await db.setState('targets', targets);
      await saveToday(); // re-score today against the new target
    } else if (['m-title', 'm-deadline', 'm-progress'].includes(t.id)) {
      mission = {
        title: $('#m-title').value.trim(),
        deadline: $('#m-deadline').value,
        progress: Number($('#m-progress').value),
      };
      await db.setState('mission', mission);
    }
  } catch (e) { showError(e); throw e; }
});
```

- [ ] **Step 3: Verify in browser**

- Change Skill target to 300 → Today view shows `…/300`, points re-scored.  Set it back to 240.
- Fill in mission title/deadline/progress → Today shows the 🎯 mission card with days-left and bar.
- Export downloads `momentum-backup-<date>.json` containing days + app_state.
- Log out → login overlay returns; log back in.

- [ ] **Step 4: Run full test suite once more**

Run: `npm test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: settings — targets, mission editor, export, logout"
```

---

### Task 16: Deploy to GitHub Pages (USER STEP for repo auth)

- [ ] **Step 1: Create the GitHub repo and push** (from the main checkout after merging the worktree branch — see Final Integration below)

```bash
gh repo create momentum --public --source=. --remote=origin --push
```

If `gh` is not installed/authenticated: create an empty public repo named `momentum` on github.com, then
`git remote add origin https://github.com/<username>/momentum.git && git push -u origin main`.

- [ ] **Step 2: Enable Pages** — repo → Settings → Pages → Source: "Deploy from a branch" → Branch `main`, folder `/ (root)` → Save. Wait ~1 minute.

- [ ] **Step 3: Verify the live site** — open `https://<username>.github.io/momentum/`, sign in, confirm the Today view loads and saves.

- [ ] **Step 4: Install on the phone** — open the URL in Safari/Chrome on the phone → Share → "Add to Home Screen". Confirm icon + standalone window, timer works on mobile.

---

### Task 17: End-to-end manual checklist (run on the live site)

- [ ] Login wrong password → error text shown under form (not silent).
- [ ] Chips, sleep toggle, minutes prompt-edit, win, both reflection fields → each persists across a hard refresh.
- [ ] Mockup parity day: enter minutes 210/90/45/20/25/10, sleep off, all 3 texts → score is exactly **80**, status Green, Health 11/20, Skill 35/40.
- [ ] Timer: start University on the computer → open the site on the phone → same timer is running there; stop on the phone → minutes banked once (not twice).
- [ ] Timer survives: lock phone 2+ minutes mid-run → unlock → elapsed time correct.
- [ ] Week/Month views render with real data; ‹ › navigation works; empty past weeks show '·' dots and no crashes.
- [ ] Settings: change a target → Today re-scores; mission card appears on Today after saving mission.
- [ ] Export downloads valid JSON (open it, spot-check today's row).
- [ ] Kill the network (airplane mode) → tap a chip → red error banner appears with Retry; restore network → Retry succeeds and banner clears.
- [ ] After midnight (or fake by changing device clock forward one day): app rolls to a fresh empty day; yesterday's data intact in Month view.

---

## Final Integration

Per `superpowers:finishing-a-development-branch`: when all tasks pass, merge the worktree branch back to `main`, run `npm test` once more on `main`, push, and confirm GitHub Pages redeployed (it auto-builds on push).

---

## Self-Review Notes (already applied)

- Spec coverage check: §2 files → Tasks 1,6,7,8,10; §3 scoring → Task 2 (+ exact mockup-day test); §4 timer → Tasks 5,12; §5 schema/RLS → Tasks 6,9; §6 screens → Tasks 11,13,14,15; §7 alert+trend → Task 4 (logic) + 11/14 (UI); §8 day rollover → Task 10 `tick()` + checklist; §9 tests → Tasks 2–5,11; §10 user setup → Tasks 9,16; export → Task 15.
- Type consistency: pillar keys `skill/uni/health/fin/eng/mind` + `refl` used identically in score.js, app.js, CSS tokens, and the spec's jsonb shape. `db.getState(key, fallback)` signature matches all call sites. `data-elapsed`, `--c`, `--p`, `--rc` attribute/CSS contracts match between app.js and style.css.
- Known simplification (intentional, spec-compliant): "Best streak" on Today is computed from the last 60 fetched days, not all history — labelled acceptable for v1.
